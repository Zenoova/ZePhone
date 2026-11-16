/**
 * @file zeaudio.c  ZePhone audio: incoming/outgoing gain, local call recording and call statistics
 *
 * One audio filter that sits in the encode path (the microphone, what the other party hears) and in
 * the decode path (the other party's voice, what the speaker plays):
 *
 *  - gain: a volume factor for each direction, changed at any time while a call is running;
 *  - recording: both directions of ONE call are written to two mono 16-bit WAV files,
 *    "<base>-tx.wav" (our microphone) and "<base>-rx.wav" (the remote voice), which the application
 *    then mixes. The remote voice is recorded before the speaker gain, so the recording does not
 *    depend on the volume the user listens at;
 *  - statistics: how regularly the audio blocks go through this filter, how long the filter itself
 *    takes, plus everything Baresip knows about the call's streams (RTP, RTCP, jitter buffer).
 *
 * REAL-TIME RULE. The filter callbacks run on the audio threads (the capture/encode thread, the RTP
 * receive/decode thread). They must never wait: no file or other system I/O, no lock that anything else
 * can hold for long. So the filters only do arithmetic, atomic loads/stores and a memcpy into a
 * lock-free ring buffer; a separate writer thread drains the rings to disk.
 *
 * Commands (sent over ctrl_tcp by the application):
 *
 *   zegain tx|rx <factor>   factor 0.0 .. 4.0 (1.0 = unchanged)
 *   zerec_start <base>      start recording; <base> is the whole parameter (spaces allowed)
 *   zerec_stop              finish both files (synchronous: the files are complete when it returns)
 *   zestats <call id>       one line of JSON with the statistics of the call (see stats_json)
 *
 * Copyright (C) 2026 ZePhone. BSD-3-Clause, like Baresip.
 */
#include <errno.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <re.h>
#include <rem.h>
#include <baresip.h>


enum {
	BASE_MAX = 1000,
	HEADER_LEN = 44,
	/** Size of each ring (a power of two): ~11 s of 48 kHz mono audio, far more than the writer ever lags. */
	RING_BYTES = 1 << 20,
	/** The writer thread wakes up this often. */
	WRITER_PERIOD_MS = 40
};

/* A block that comes later than this many times its length after the previous one counts as late. */
#define LATE_FACTOR 1.75
/* ...plus this much slack, in microseconds. */
#define LATE_SLACK_US 6000
/* Past this gap (2 s) the audio was paused, so the block is not counted as late. */
#define RESTART_GAP_US 2000000u


/* ---------------------------------------------------------------------------------------------
 * Time
 */

static uint64_t now_us(void)
{
	struct timespec ts;

	clock_gettime(CLOCK_MONOTONIC, &ts);
	return (uint64_t)ts.tv_sec * 1000000u + (uint64_t)ts.tv_nsec / 1000u;
}


/* ---------------------------------------------------------------------------------------------
 * Ring buffer: one producer (an audio thread), one consumer (the writer thread)
 */

struct ring {
	uint8_t *buf;
	_Atomic size_t head;   /* bytes ever written, advanced by the producer */
	_Atomic size_t tail;   /* bytes ever read, advanced by the consumer    */
};


static bool ring_push(struct ring *r, const void *data, size_t n)
{
	size_t h = atomic_load_explicit(&r->head, memory_order_relaxed);
	size_t t = atomic_load_explicit(&r->tail, memory_order_acquire);
	size_t pos, first;

	if (RING_BYTES - (h - t) < n)
		return false;

	pos = h & (RING_BYTES - 1);
	first = RING_BYTES - pos < n ? RING_BYTES - pos : n;
	memcpy(r->buf + pos, data, first);
	memcpy(r->buf, (const uint8_t *)data + first, n - first);
	atomic_store_explicit(&r->head, h + n, memory_order_release);
	return true;
}


/* ---------------------------------------------------------------------------------------------
 * Recording state
 */

struct side {
	struct ring ring;
	_Atomic uint32_t srate;     /* published by the producer before its first push */
	_Atomic uint32_t dropped;   /* samples lost because the ring was full           */
	_Atomic uint32_t queued_max;/* most bytes ever waiting in the ring (high-water) */
	/* Writer thread only: */
	FILE *f;
	uint32_t file_rate;
	uint32_t bytes;
};

static struct {
	_Atomic double gain_tx;
	_Atomic double gain_rx;
	_Atomic bool rec;             /* recording requested                                  */
	_Atomic uintptr_t owner;      /* the call being recorded: first one heard after start */
	struct side tx;
	struct side rx;
	/* Main thread only (commands): */
	char base[BASE_MAX + 1];
	pthread_t thr;
	bool thr_started;
	_Atomic bool thr_run;
} g;


/* ---------------------------------------------------------------------------------------------
 * Per-filter statistics
 */

struct fstat {
	struct fstat *next;
	const struct audio *au;
	bool enc;
	_Atomic uint64_t frames;
	_Atomic uint64_t last_us;       /* when the previous block went through */
	_Atomic uint64_t late_total;    /* blocks that came late, since the call started */
	_Atomic uint32_t gap_max_us;    /* longest gap between two blocks, since the last read */
	_Atomic uint32_t busy_max_us;   /* longest time spent inside this filter, since the last read */
	uint32_t srate;
	uint8_t ch;
};

static struct fstat *reg_head;
static pthread_mutex_t reg_mtx = PTHREAD_MUTEX_INITIALIZER;


static void reg_add(struct fstat *st)
{
	pthread_mutex_lock(&reg_mtx);
	st->next = reg_head;
	reg_head = st;
	pthread_mutex_unlock(&reg_mtx);
}


static void reg_remove(struct fstat *st)
{
	pthread_mutex_lock(&reg_mtx);
	for (struct fstat **pp = &reg_head; *pp; pp = &(*pp)->next) {
		if (*pp == st) {
			*pp = st->next;
			break;
		}
	}
	pthread_mutex_unlock(&reg_mtx);
}


/* Called by the filters, on the audio threads: no locks, no I/O. */
static void note_block(struct fstat *st, const struct auframe *af, uint64_t t0)
{
	uint64_t last = atomic_load_explicit(&st->last_us, memory_order_relaxed);

	/* A gap of seconds is a pause (hold, resume), not an irregular block. */
	if (last && t0 - last < RESTART_GAP_US && af->srate && af->ch) {
		uint64_t gap = t0 - last;
		uint64_t len = (uint64_t)af->sampc * 1000000u /
			       ((uint64_t)af->srate * af->ch);
		uint32_t cur = atomic_load_explicit(&st->gap_max_us,
						    memory_order_relaxed);

		if (gap > cur)
			atomic_store_explicit(&st->gap_max_us,
					      gap > UINT32_MAX ? UINT32_MAX : (uint32_t)gap,
					      memory_order_relaxed);
		if ((double)gap > (double)len * LATE_FACTOR + LATE_SLACK_US)
			atomic_fetch_add_explicit(&st->late_total, 1,
						  memory_order_relaxed);
	}
	atomic_store_explicit(&st->last_us, t0, memory_order_relaxed);
	atomic_fetch_add_explicit(&st->frames, 1, memory_order_relaxed);
}


static void note_busy(struct fstat *st, uint64_t t0)
{
	uint64_t dt = now_us() - t0;
	uint32_t cur = atomic_load_explicit(&st->busy_max_us,
					    memory_order_relaxed);

	if (dt > cur)
		atomic_store_explicit(&st->busy_max_us,
				      dt > UINT32_MAX ? UINT32_MAX : (uint32_t)dt,
				      memory_order_relaxed);
}


struct zeaudio_enc {
	struct aufilt_enc_st af;  /* base class */
	struct fstat stat;
	bool pcm;
};

struct zeaudio_dec {
	struct aufilt_dec_st af;  /* base class */
	struct fstat stat;
	bool pcm;
};


/* ---------------------------------------------------------------------------------------------
 * Samples
 */

static void apply_gain(int16_t *s, size_t n, double gain)
{
	if (gain == 1.0)
		return;

	for (size_t i = 0; i < n; i++) {
		double v = s[i] * gain;

		if (v > 32767.0)
			v = 32767.0;
		else if (v < -32768.0)
			v = -32768.0;
		s[i] = (int16_t)v;
	}
}


/* Mono, whatever the number of channels: the channels of a frame are averaged. */
static void push_mono(struct side *sd, const struct auframe *af)
{
	const int16_t *in = af->sampv;
	const size_t ch = af->ch > 1 ? af->ch : 1;
	size_t frames = af->sampc / ch;
	int16_t mono[2048];

	if (!atomic_load_explicit(&sd->srate, memory_order_relaxed))
		atomic_store_explicit(&sd->srate, af->srate,
				      memory_order_release);

	while (frames) {
		const size_t n = frames < RE_ARRAY_SIZE(mono) ?
			frames : RE_ARRAY_SIZE(mono);
		size_t queued;

		for (size_t i = 0; i < n; i++) {
			int32_t sum = 0;

			for (size_t c = 0; c < ch; c++)
				sum += in[i * ch + c];
			mono[i] = (int16_t)(sum / (int32_t)ch);
		}

		if (!ring_push(&sd->ring, mono, n * sizeof(int16_t)))
			atomic_fetch_add_explicit(&sd->dropped, (uint32_t)n,
						  memory_order_relaxed);

		queued = atomic_load_explicit(&sd->ring.head,
					      memory_order_relaxed) -
			 atomic_load_explicit(&sd->ring.tail,
					      memory_order_relaxed);
		if (queued > atomic_load_explicit(&sd->queued_max,
						  memory_order_relaxed))
			atomic_store_explicit(&sd->queued_max,
					      (uint32_t)queued,
					      memory_order_relaxed);
		in += n * ch;
		frames -= n;
	}
}


/* Records this block if this call is the one being recorded. */
static void record(struct side *sd, const struct audio *au,
		   const struct auframe *af)
{
	uintptr_t me = (uintptr_t)au;
	uintptr_t cur;

	if (!atomic_load_explicit(&g.rec, memory_order_acquire))
		return;

	cur = atomic_load_explicit(&g.owner, memory_order_relaxed);
	if (!cur) {
		uintptr_t none = 0;

		if (atomic_compare_exchange_strong(&g.owner, &none, me))
			cur = me;
		else
			cur = none;
	}
	if (cur == me)
		push_mono(sd, af);
}


/* ---------------------------------------------------------------------------------------------
 * The writer thread: the only place that touches the disk
 */

static void put_le32(uint8_t *p, uint32_t v)
{
	p[0] = (uint8_t)v;
	p[1] = (uint8_t)(v >> 8);
	p[2] = (uint8_t)(v >> 16);
	p[3] = (uint8_t)(v >> 24);
}


static void put_le16(uint8_t *p, uint16_t v)
{
	p[0] = (uint8_t)v;
	p[1] = (uint8_t)(v >> 8);
}


/* Writes the canonical 44-byte header for `bytes` bytes of PCM data at the current start of the file. */
static int wav_header(FILE *f, uint32_t srate, uint32_t bytes)
{
	uint8_t h[HEADER_LEN];

	memcpy(h, "RIFF", 4);
	put_le32(h + 4, 36 + bytes);
	memcpy(h + 8, "WAVEfmt ", 8);
	put_le32(h + 16, 16);
	put_le16(h + 20, 1);                       /* PCM */
	put_le16(h + 22, 1);                       /* mono */
	put_le32(h + 24, srate);
	put_le32(h + 28, srate * 2);               /* byte rate */
	put_le16(h + 32, 2);                       /* block align */
	put_le16(h + 34, 16);                      /* bits per sample */
	memcpy(h + 36, "data", 4);
	put_le32(h + 40, bytes);

	return fwrite(h, 1, sizeof(h), f) == sizeof(h) ? 0 : EIO;
}


static void side_close(struct side *sd, const char *name)
{
	if (!sd->f)
		return;

	if (fseek(sd->f, 0, SEEK_SET) == 0)
		(void)wav_header(sd->f, sd->file_rate, sd->bytes);
	fclose(sd->f);
	sd->f = NULL;
	info("zeaudio: %s finished (%u bytes, %u samples dropped)\n", name,
	     sd->bytes,
	     (unsigned)atomic_load_explicit(&sd->dropped,
					    memory_order_relaxed));
}


static void side_drain(struct side *sd, const char *suffix)
{
	size_t t = atomic_load_explicit(&sd->ring.tail, memory_order_relaxed);
	size_t h = atomic_load_explicit(&sd->ring.head, memory_order_acquire);
	size_t pos, first, n = h - t;

	if (!n)
		return;

	if (!sd->f) {
		char path[BASE_MAX + 16];
		uint32_t rate = atomic_load_explicit(&sd->srate,
						     memory_order_acquire);

		re_snprintf(path, sizeof(path), "%s-%s.wav", g.base, suffix);
		sd->f = fopen(path, "wb");
		if (!sd->f) {
			warning("zeaudio: cannot create %s (%s)\n", path,
				strerror(errno));
			/* Drop what is queued so the ring does not fill up. */
			atomic_store_explicit(&sd->ring.tail, h,
					      memory_order_release);
			return;
		}
		setvbuf(sd->f, NULL, _IOFBF, 1 << 16);
		sd->file_rate = rate ? rate : 8000;
		sd->bytes = 0;
		(void)wav_header(sd->f, sd->file_rate, 0);
		info("zeaudio: recording %s audio (%u Hz, mono)\n", suffix,
		     sd->file_rate);
	}

	pos = t & (RING_BYTES - 1);
	first = RING_BYTES - pos < n ? RING_BYTES - pos : n;
	sd->bytes += (uint32_t)fwrite(sd->ring.buf + pos, 1, first, sd->f);
	if (n > first)
		sd->bytes += (uint32_t)fwrite(sd->ring.buf, 1, n - first,
					      sd->f);
	atomic_store_explicit(&sd->ring.tail, h, memory_order_release);
}


static void *writer_main(void *arg)
{
	struct timespec nap = { 0, WRITER_PERIOD_MS * 1000000L };
	(void)arg;

	while (atomic_load_explicit(&g.thr_run, memory_order_acquire)) {
		side_drain(&g.tx, "tx");
		side_drain(&g.rx, "rx");
		nanosleep(&nap, NULL);
	}

	/* One last pass for what the audio threads pushed just before the stop. */
	side_drain(&g.tx, "tx");
	side_drain(&g.rx, "rx");
	side_close(&g.tx, "tx");
	side_close(&g.rx, "rx");
	return NULL;
}


/* Main thread. Finishes the recording: when this returns the files are complete. */
static void rec_stop(void)
{
	atomic_store_explicit(&g.rec, false, memory_order_release);
	atomic_store_explicit(&g.owner, 0, memory_order_relaxed);

	if (g.thr_started) {
		atomic_store_explicit(&g.thr_run, false, memory_order_release);
		pthread_join(g.thr, NULL);
		g.thr_started = false;
	}
}


/* ---------------------------------------------------------------------------------------------
 * The audio filters
 */

static void enc_destructor(void *arg)
{
	struct zeaudio_enc *st = arg;

	reg_remove(&st->stat);
	list_unlink(&st->af.le);
}


static void dec_destructor(void *arg)
{
	struct zeaudio_dec *st = arg;

	reg_remove(&st->stat);
	list_unlink(&st->af.le);
}


static int encode_update(struct aufilt_enc_st **stp, void **ctx,
			 const struct aufilt *af, struct aufilt_prm *prm,
			 const struct audio *au)
{
	struct zeaudio_enc *st;
	(void)ctx;
	(void)af;

	if (!stp || !prm)
		return EINVAL;

	if (*stp)
		return 0;

	st = mem_zalloc(sizeof(*st), enc_destructor);
	if (!st)
		return ENOMEM;

	st->stat.au = au;
	st->stat.enc = true;
	st->stat.srate = prm->srate;
	st->stat.ch = prm->ch;
	st->pcm = prm->fmt == AUFMT_S16LE;   /* anything else passes through untouched */
	reg_add(&st->stat);

	*stp = (struct aufilt_enc_st *)st;
	return 0;
}


static int decode_update(struct aufilt_dec_st **stp, void **ctx,
			 const struct aufilt *af, struct aufilt_prm *prm,
			 const struct audio *au)
{
	struct zeaudio_dec *st;
	(void)ctx;
	(void)af;

	if (!stp || !prm)
		return EINVAL;

	if (*stp)
		return 0;

	st = mem_zalloc(sizeof(*st), dec_destructor);
	if (!st)
		return ENOMEM;

	st->stat.au = au;
	st->stat.enc = false;
	st->stat.srate = prm->srate;
	st->stat.ch = prm->ch;
	st->pcm = prm->fmt == AUFMT_S16LE;
	reg_add(&st->stat);

	*stp = (struct aufilt_dec_st *)st;
	return 0;
}


/* Microphone -> network. */
static int encode(struct aufilt_enc_st *st, struct auframe *af)
{
	struct zeaudio_enc *e = (void *)st;
	uint64_t t0;

	if (!e || !af || !af->sampv)
		return EINVAL;

	t0 = now_us();
	note_block(&e->stat, af, t0);
	if (!e->pcm || af->fmt != AUFMT_S16LE)
		return 0;

	apply_gain(af->sampv, af->sampc,
		   atomic_load_explicit(&g.gain_tx, memory_order_relaxed));
	record(&g.tx, e->stat.au, af);
	note_busy(&e->stat, t0);
	return 0;
}


/* Network -> speaker. */
static int decode(struct aufilt_dec_st *st, struct auframe *af)
{
	struct zeaudio_dec *d = (void *)st;
	uint64_t t0;

	if (!d || !af || !af->sampv)
		return EINVAL;

	t0 = now_us();
	note_block(&d->stat, af, t0);
	if (!d->pcm || af->fmt != AUFMT_S16LE)
		return 0;

	record(&g.rx, d->stat.au, af);   /* before the speaker gain */
	apply_gain(af->sampv, af->sampc,
		   atomic_load_explicit(&g.gain_rx, memory_order_relaxed));
	note_busy(&d->stat, t0);
	return 0;
}


static struct aufilt zeaudio = {
	.name    = "zeaudio",
	.encupdh = encode_update,
	.ench    = encode,
	.decupdh = decode_update,
	.dech    = decode
};


/* ---------------------------------------------------------------------------------------------
 * Commands
 */

static int cmd_gain(struct re_printf *pf, void *arg)
{
	const struct cmd_arg *carg = arg;
	char dir[4] = "";
	double factor = -1.0;
	(void)pf;

	if (!carg || !str_isset(carg->prm) ||
	    sscanf(carg->prm, "%3s %lf", dir, &factor) != 2 ||
	    !(factor >= 0.0 && factor <= 4.0)) {
		warning("zeaudio: usage: zegain tx|rx <0.0-4.0>\n");
		return EINVAL;
	}

	if (!strcmp(dir, "tx"))
		atomic_store_explicit(&g.gain_tx, factor, memory_order_relaxed);
	else if (!strcmp(dir, "rx"))
		atomic_store_explicit(&g.gain_rx, factor, memory_order_relaxed);
	else
		return EINVAL;

	info("zeaudio: %s gain is now %.2f\n", dir, factor);
	return 0;
}


static void side_reset(struct side *sd)
{
	atomic_store(&sd->ring.head, 0);
	atomic_store(&sd->ring.tail, 0);
	atomic_store(&sd->srate, 0);
	atomic_store(&sd->dropped, 0);
	atomic_store(&sd->queued_max, 0);
	sd->bytes = 0;
}


static int cmd_rec_start(struct re_printf *pf, void *arg)
{
	const struct cmd_arg *carg = arg;
	(void)pf;

	if (!carg || !str_isset(carg->prm) || str_len(carg->prm) > BASE_MAX) {
		warning("zeaudio: usage: zerec_start <base path>\n");
		return EINVAL;
	}

	rec_stop();   /* a recording still running is finished first */

	str_ncpy(g.base, carg->prm, sizeof(g.base));
	side_reset(&g.tx);
	side_reset(&g.rx);
	atomic_store(&g.owner, 0);
	atomic_store(&g.thr_run, true);
	if (pthread_create(&g.thr, NULL, writer_main, NULL)) {
		atomic_store(&g.thr_run, false);
		return EIO;
	}
	g.thr_started = true;
	atomic_store_explicit(&g.rec, true, memory_order_release);

	info("zeaudio: recording to %s-{tx,rx}.wav\n", carg->prm);
	return 0;
}


static int cmd_rec_stop(struct re_printf *pf, void *arg)
{
	(void)pf;
	(void)arg;

	rec_stop();
	return 0;
}


static const struct fstat *find_stat(const struct audio *au, bool enc)
{
	const struct fstat *found = NULL;

	for (const struct fstat *s = reg_head; s; s = s->next) {
		if (s->au == au && s->enc == enc) {
			found = s;
			break;
		}
	}
	return found;
}


/** Prints the filter part of the statistics, and starts a new window for the maxima. */
static int print_filter(struct re_printf *pf, const char *name,
			const struct fstat *s)
{
	struct fstat *w = (struct fstat *)s;   /* only the atomics are written */

	if (!s)
		return re_hprintf(pf,
				  "\"%s\":{\"frames\":0,\"late\":0,"
				  "\"gapMaxUs\":0,\"busyMaxUs\":0,"
				  "\"srate\":0,\"channels\":0}",
				  name);

	return re_hprintf(pf,
			  "\"%s\":{\"frames\":%llu,\"late\":%llu,"
			  "\"gapMaxUs\":%u,\"busyMaxUs\":%u,"
			  "\"srate\":%u,\"channels\":%u}",
			  name,
			  (unsigned long long)atomic_load(&w->frames),
			  (unsigned long long)atomic_load(&w->late_total),
			  (unsigned)atomic_exchange(&w->gap_max_us, 0),
			  (unsigned)atomic_exchange(&w->busy_max_us, 0),
			  s->srate, (unsigned)s->ch);
}


/*
 * zestats <call id>: one line of JSON. The "window" maxima (gapMaxUs, busyMaxUs) cover the time since the
 * previous zestats, so the application reads them once a second and gets one value per second.
 */
static int cmd_stats(struct re_printf *pf, void *arg)
{
	const struct cmd_arg *carg = arg;
	const struct audio *au;
	const struct stream *strm;
	const struct rtcp_stats *rs;
	const struct aucodec *rxc, *txc;
	struct jbuf_stat js;
	struct call *call;
	int err = 0;

	if (!carg || !str_isset(carg->prm))
		return EINVAL;

	call = uag_call_find(carg->prm);
	au = call ? call_audio(call) : NULL;
	strm = au ? audio_strm(au) : NULL;
	if (!strm)
		return re_hprintf(pf, "{\"found\":false}");

	memset(&js, 0, sizeof(js));
	(void)stream_jbuf_stats(strm, &js);
	rs = stream_rtcp_stats(strm);
	rxc = audio_codec(au, false);
	txc = audio_codec(au, true);

	err |= re_hprintf(pf, "{\"found\":true,\"codec\":\"%s\",\"txCodec\":\"%s\","
			  "\"clockRate\":%u,",
			  rxc ? rxc->name : "", txc ? txc->name : "",
			  rxc ? rxc->srate : 0);
	err |= re_hprintf(pf,
			  "\"rtp\":{\"txPackets\":%u,\"txBytes\":%u,\"txErrors\":%u,"
			  "\"txBitrate\":%u,\"rxPackets\":%u,\"rxBytes\":%u,"
			  "\"rxErrors\":%u,\"rxBitrate\":%u},",
			  stream_metric_get_tx_n_packets(strm),
			  stream_metric_get_tx_n_bytes(strm),
			  stream_metric_get_tx_n_err(strm),
			  stream_metric_get_tx_bitrate(strm),
			  stream_metric_get_rx_n_packets(strm),
			  stream_metric_get_rx_n_bytes(strm),
			  stream_metric_get_rx_n_err(strm),
			  stream_metric_get_rx_bitrate(strm));
	err |= re_hprintf(pf,
			  "\"rtcp\":{\"available\":%s,\"txLost\":%d,\"txJitterUs\":%u,"
			  "\"rxLost\":%d,\"rxJitterUs\":%u,\"rttUs\":%u},",
			  rs ? "true" : "false",
			  rs ? rs->tx.lost : 0, rs ? rs->tx.jit : 0,
			  rs ? rs->rx.lost : 0, rs ? rs->rx.jit : 0,
			  rs ? rs->rtt : 0);
	err |= re_hprintf(pf,
			  "\"jbuf\":{\"put\":%u,\"get\":%u,\"outOfSeq\":%u,\"dups\":%u,"
			  "\"late\":%u,\"lateLost\":%u,\"lost\":%u,\"overflow\":%u,"
			  "\"flush\":%u,\"delayMs\":%u,\"packets\":%u,\"jitterMs\":%u,"
			  "\"skewMs\":%d},",
			  js.n_put, js.n_get, js.n_oos, js.n_dups, js.n_late,
			  js.n_late_lost, js.n_lost, js.n_overflow, js.n_flush,
			  js.c_delay, js.c_packets, js.c_jitter, js.c_skew);

	pthread_mutex_lock(&reg_mtx);
	err |= re_hprintf(pf, "\"filters\":{");
	err |= print_filter(pf, "rx", find_stat(au, false));
	err |= re_hprintf(pf, ",");
	err |= print_filter(pf, "tx", find_stat(au, true));
	pthread_mutex_unlock(&reg_mtx);
	err |= re_hprintf(pf, ",\"recording\":{\"on\":%s,\"droppedSamples\":%u,"
			  "\"queuedMaxBytes\":%u}}}",
			  atomic_load(&g.rec) ? "true" : "false",
			  (unsigned)(atomic_load(&g.tx.dropped) +
				     atomic_load(&g.rx.dropped)),
			  (unsigned)(atomic_load(&g.tx.queued_max) >
						     atomic_load(&g.rx.queued_max) ?
					     atomic_load(&g.tx.queued_max) :
					     atomic_load(&g.rx.queued_max)));
	return err;
}


static const struct cmd cmdv[] = {
	{"zegain",      0, CMD_PRM, "Set the gain: zegain tx|rx <factor>", cmd_gain},
	{"zerec_start", 0, CMD_PRM, "Start recording the call: zerec_start <base path>", cmd_rec_start},
	{"zerec_stop",  0, 0,       "Stop recording the call", cmd_rec_stop},
	{"zestats",     0, CMD_PRM, "Statistics of a call as JSON: zestats <call id>", cmd_stats},
};


static int module_init(void)
{
	g.tx.ring.buf = calloc(1, RING_BYTES);
	g.rx.ring.buf = calloc(1, RING_BYTES);
	if (!g.tx.ring.buf || !g.rx.ring.buf) {
		free(g.tx.ring.buf);
		free(g.rx.ring.buf);
		g.tx.ring.buf = g.rx.ring.buf = NULL;
		return ENOMEM;
	}
	atomic_store(&g.gain_tx, 1.0);
	atomic_store(&g.gain_rx, 1.0);

	aufilt_register(baresip_aufiltl(), &zeaudio);
	return cmd_register(baresip_commands(), cmdv, RE_ARRAY_SIZE(cmdv));
}


static int module_close(void)
{
	cmd_unregister(baresip_commands(), cmdv);
	aufilt_unregister(&zeaudio);
	rec_stop();
	free(g.tx.ring.buf);
	free(g.rx.ring.buf);
	g.tx.ring.buf = g.rx.ring.buf = NULL;
	return 0;
}


EXPORT_SYM const struct mod_export DECL_EXPORTS(zeaudio) = {
	"zeaudio",
	"filter",
	module_init,
	module_close
};
