/**
 * @file zeaudio.c  ZePhone audio: incoming/outgoing gain and local call recording
 *
 * One audio filter that sits in the encode path (the microphone, what the other party hears) and in
 * the decode path (the other party's voice, what the speaker plays):
 *
 *  - gain: a volume factor for each direction, changed at any time while a call is running;
 *  - recording: both directions of ONE call are written to two mono 16-bit WAV files,
 *    "<base>-tx.wav" (our microphone) and "<base>-rx.wav" (the remote voice), which the application
 *    then mixes. The remote voice is recorded before the speaker gain, so the recording does not
 *    depend on the volume the user listens at.
 *
 * Commands (sent over ctrl_tcp by the application):
 *
 *   zegain tx|rx <factor>   factor 0.0 .. 4.0 (1.0 = unchanged)
 *   zerec_start <base>      start recording; <base> is the whole parameter (spaces allowed)
 *   zerec_stop              finish both files (synchronous: the files are complete when it returns)
 *
 * Copyright (C) 2026 ZePhone. BSD-3-Clause, like Baresip.
 */
#include <errno.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <re.h>
#include <rem.h>
#include <baresip.h>


enum {
	BASE_MAX = 1000,
	HEADER_LEN = 44
};

struct wav {
	FILE *f;
	uint32_t srate;
	uint16_t ch;
	uint32_t bytes;
};

/* Everything shared between the Baresip main thread (commands) and the audio threads (frames). */
static struct {
	pthread_mutex_t mtx;
	double gain_tx;
	double gain_rx;
	bool rec;
	char base[BASE_MAX + 1];
	const struct audio *owner;   /* the call being recorded: the first one heard after the start */
	struct wav tx;
	struct wav rx;
} g = {
	.mtx = PTHREAD_MUTEX_INITIALIZER,
	.gain_tx = 1.0,
	.gain_rx = 1.0,
};

struct zeaudio_enc {
	struct aufilt_enc_st af;  /* base class */
	const struct audio *au;
	bool pcm;
};

struct zeaudio_dec {
	struct aufilt_dec_st af;  /* base class */
	const struct audio *au;
	bool pcm;
};


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
static int wav_header(FILE *f, uint32_t srate, uint16_t ch, uint32_t bytes)
{
	uint8_t h[HEADER_LEN];

	memcpy(h, "RIFF", 4);
	put_le32(h + 4, 36 + bytes);
	memcpy(h + 8, "WAVEfmt ", 8);
	put_le32(h + 16, 16);
	put_le16(h + 20, 1);                       /* PCM */
	put_le16(h + 22, ch);
	put_le32(h + 24, srate);
	put_le32(h + 28, srate * ch * 2);          /* byte rate */
	put_le16(h + 32, (uint16_t)(ch * 2));      /* block align */
	put_le16(h + 34, 16);                      /* bits per sample */
	memcpy(h + 36, "data", 4);
	put_le32(h + 40, bytes);

	return fwrite(h, 1, sizeof(h), f) == sizeof(h) ? 0 : EIO;
}


/* Caller holds g.mtx. */
static void wav_close(struct wav *w, const char *event)
{
	if (!w->f)
		return;

	if (fseek(w->f, 0, SEEK_SET) == 0)
		(void)wav_header(w->f, w->srate, w->ch, w->bytes);
	fclose(w->f);
	w->f = NULL;
	info("zeaudio: %s finished (%u bytes)\n", event, w->bytes);
}


/* Caller holds g.mtx. Always mono: the channels of a multi-channel frame are averaged. */
static int wav_open(struct wav *w, const char *suffix, const struct auframe *af)
{
	char path[BASE_MAX + 16];

	re_snprintf(path, sizeof(path), "%s-%s.wav", g.base, suffix);
	w->f = fopen(path, "wb");
	if (!w->f)
		return errno;

	w->srate = af->srate;
	w->ch = 1;
	w->bytes = 0;
	if (wav_header(w->f, w->srate, w->ch, 0)) {
		fclose(w->f);
		w->f = NULL;
		return EIO;
	}

	info("zeaudio: recording %s audio (%u Hz, %u ch -> mono)\n", suffix,
	     w->srate, (unsigned)(af->ch ? af->ch : 1));
	return 0;
}


/* Caller holds g.mtx. */
static void wav_write(struct wav *w, const char *suffix, const struct auframe *af)
{
	const int16_t *in = af->sampv;
	const size_t ch = af->ch > 1 ? af->ch : 1;
	size_t frames = af->sampc / ch;
	int16_t mono[2048];

	if (!w->f && wav_open(w, suffix, af))
		return;

	while (frames) {
		const size_t n = frames < RE_ARRAY_SIZE(mono) ?
			frames : RE_ARRAY_SIZE(mono);

		for (size_t i = 0; i < n; i++) {
			int32_t sum = 0;

			for (size_t c = 0; c < ch; c++)
				sum += in[i * ch + c];
			mono[i] = (int16_t)(sum / (int32_t)ch);
		}

		w->bytes += (uint32_t)(fwrite(mono, sizeof(int16_t), n, w->f)
				       * sizeof(int16_t));
		in += n * ch;
		frames -= n;
	}
}


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


static void enc_destructor(void *arg)
{
	struct zeaudio_enc *st = arg;

	pthread_mutex_lock(&g.mtx);
	if (g.owner == st->au)
		wav_close(&g.tx, "tx");
	pthread_mutex_unlock(&g.mtx);

	list_unlink(&st->af.le);
}


static void dec_destructor(void *arg)
{
	struct zeaudio_dec *st = arg;

	pthread_mutex_lock(&g.mtx);
	if (g.owner == st->au)
		wav_close(&g.rx, "rx");
	pthread_mutex_unlock(&g.mtx);

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

	st->au = au;
	st->pcm = prm->fmt == AUFMT_S16LE;   /* anything else passes through untouched */

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

	st->au = au;
	st->pcm = prm->fmt == AUFMT_S16LE;

	*stp = (struct aufilt_dec_st *)st;
	return 0;
}


/* Microphone -> network. */
static int encode(struct aufilt_enc_st *st, struct auframe *af)
{
	struct zeaudio_enc *e = (void *)st;

	if (!e || !af || !af->sampv)
		return EINVAL;
	if (!e->pcm || af->fmt != AUFMT_S16LE)
		return 0;

	pthread_mutex_lock(&g.mtx);
	apply_gain(af->sampv, af->sampc, g.gain_tx);
	if (g.rec) {
		if (!g.owner)
			g.owner = e->au;
		if (g.owner == e->au)
			wav_write(&g.tx, "tx", af);
	}
	pthread_mutex_unlock(&g.mtx);

	return 0;
}


/* Network -> speaker. */
static int decode(struct aufilt_dec_st *st, struct auframe *af)
{
	struct zeaudio_dec *d = (void *)st;

	if (!d || !af || !af->sampv)
		return EINVAL;
	if (!d->pcm || af->fmt != AUFMT_S16LE)
		return 0;

	pthread_mutex_lock(&g.mtx);
	if (g.rec) {
		if (!g.owner)
			g.owner = d->au;
		if (g.owner == d->au)
			wav_write(&g.rx, "rx", af);   /* before the speaker gain */
	}
	apply_gain(af->sampv, af->sampc, g.gain_rx);
	pthread_mutex_unlock(&g.mtx);

	return 0;
}


static struct aufilt zeaudio = {
	.name    = "zeaudio",
	.encupdh = encode_update,
	.ench    = encode,
	.decupdh = decode_update,
	.dech    = decode
};


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

	pthread_mutex_lock(&g.mtx);
	if (!strcmp(dir, "tx"))
		g.gain_tx = factor;
	else if (!strcmp(dir, "rx"))
		g.gain_rx = factor;
	else {
		pthread_mutex_unlock(&g.mtx);
		return EINVAL;
	}
	pthread_mutex_unlock(&g.mtx);

	info("zeaudio: %s gain is now %.2f\n", dir, factor);
	return 0;
}


static int cmd_rec_start(struct re_printf *pf, void *arg)
{
	const struct cmd_arg *carg = arg;
	(void)pf;

	if (!carg || !str_isset(carg->prm) || str_len(carg->prm) > BASE_MAX) {
		warning("zeaudio: usage: zerec_start <base path>\n");
		return EINVAL;
	}

	pthread_mutex_lock(&g.mtx);
	wav_close(&g.tx, "tx");
	wav_close(&g.rx, "rx");
	str_ncpy(g.base, carg->prm, sizeof(g.base));
	g.owner = NULL;
	g.rec = true;
	pthread_mutex_unlock(&g.mtx);

	info("zeaudio: recording to %s-{tx,rx}.wav\n", carg->prm);
	return 0;
}


static int cmd_rec_stop(struct re_printf *pf, void *arg)
{
	(void)pf;
	(void)arg;

	pthread_mutex_lock(&g.mtx);
	g.rec = false;
	wav_close(&g.tx, "tx");
	wav_close(&g.rx, "rx");
	g.owner = NULL;
	pthread_mutex_unlock(&g.mtx);

	return 0;
}


static const struct cmd cmdv[] = {
	{"zegain",      0, CMD_PRM, "Set the gain: zegain tx|rx <factor>", cmd_gain},
	{"zerec_start", 0, CMD_PRM, "Start recording the call: zerec_start <base path>", cmd_rec_start},
	{"zerec_stop",  0, 0,       "Stop recording the call", cmd_rec_stop},
};


static int module_init(void)
{
	aufilt_register(baresip_aufiltl(), &zeaudio);
	return cmd_register(baresip_commands(), cmdv, RE_ARRAY_SIZE(cmdv));
}


static int module_close(void)
{
	cmd_unregister(baresip_commands(), cmdv);
	aufilt_unregister(&zeaudio);

	pthread_mutex_lock(&g.mtx);
	g.rec = false;
	wav_close(&g.tx, "tx");
	wav_close(&g.rx, "rx");
	pthread_mutex_unlock(&g.mtx);

	return 0;
}


EXPORT_SYM const struct mod_export DECL_EXPORTS(zeaudio) = {
	"zeaudio",
	"filter",
	module_init,
	module_close
};
