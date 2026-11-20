/**
 * @file zephone_engine.c  Baresip's main(), made callable and stoppable (see zephone_engine.h).
 *
 * Baresip is BSD-3-Clause licensed; this file follows the start-up sequence of its src/main.c, without the command
 * line, the daemon mode, the signal handlers (they would take the whole application down) and the console output.
 */

#include <arpa/inet.h>
#include <errno.h>
#include <resolv.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdatomic.h>
#include <string.h>
#include <re.h>
#define DEBUG_MODULE "zephone"
#define DEBUG_LEVEL 0
#include <re_dbg.h>
#include <baresip.h>

#include "zephone_engine.h"

enum { ASYNC_WORKERS = 4, STOP_POLL_MS = 200 };

static atomic_int g_running;
static atomic_int g_stop;
static zephone_log_fn g_log;
static struct tmr g_stop_tmr;

static void log_handler(uint32_t level, const char *msg)
{
	zephone_log_fn cb = g_log;
	char line[1024];
	size_t n;

	if (!cb)
		return;

	/* Baresip ends its lines with a line break and may log several at once. */
	str_ncpy(line, msg, sizeof(line));
	n = strlen(line);
	while (n > 0 && (line[n - 1] == '\n' || line[n - 1] == '\r'))
		line[--n] = '\0';
	if (n)
		cb(level, line);
}

static struct log g_logger = {.h = log_handler};

static void ua_exit_handler(void *arg)
{
	(void)arg;
	re_cancel();
}

/* Stopping is requested from another thread: it only sets a flag, the engine's own loop acts on it. */
static void stop_poll(void *arg)
{
	(void)arg;
	if (atomic_load(&g_stop)) {
		ua_stop_all(true);
		return;
	}
	tmr_start(&g_stop_tmr, STOP_POLL_MS, stop_poll, NULL);
}

int zephone_engine_dns_servers(char *out, size_t size)
{
	union res_sockaddr_union servers[8];
	struct __res_state *state;
	size_t used = 0;
	int count, i;

	if (!out || size == 0)
		return EINVAL;
	out[0] = '\0';

	state = calloc(1, sizeof(*state));
	if (!state)
		return ENOMEM;
	if (res_ninit(state) != 0) {
		free(state);
		return ENOENT;
	}

	count = res_getservers(state, servers, 8);
	for (i = 0; i < count; i++) {
		char text[INET6_ADDRSTRLEN] = "";
		int n;

		if (servers[i].sin.sin_family == AF_INET)
			inet_ntop(AF_INET, &servers[i].sin.sin_addr, text, sizeof(text));
		else if (servers[i].sin6.sin6_family == AF_INET6)
			inet_ntop(AF_INET6, &servers[i].sin6.sin6_addr, text, sizeof(text));
		if (!text[0])
			continue;
		n = snprintf(out + used, size - used, "%s\n", text);
		if (n < 0 || (size_t)n >= size - used)
			break;
		used += (size_t)n;
	}

	res_ndestroy(state);
	free(state);
	return 0;
}

const char *zephone_engine_version(void)
{
	return baresip_version();
}

void zephone_engine_stop(void)
{
	atomic_store(&g_stop, 1);
}

int zephone_engine_run(const char *config_dir, int sip_trace, zephone_log_fn log)
{
	const char *software = "baresip v" BARESIP_VERSION " (ios)";
	int err;

	if (!config_dir)
		return EINVAL;

	int expected = 0;
	if (!atomic_compare_exchange_strong(&g_running, &expected, 1))
		return EBUSY;
	atomic_store(&g_stop, 0);
	g_log = log;

	/* Everything the engine says goes to the application, nothing to the console. */
	log_enable_stdout(false);
	log_register_handler(&g_logger);

	err = libre_init();
	if (err)
		goto out;

	tmr_init(&g_stop_tmr);
	dbg_init(DBG_INFO, DBG_NONE);
	conf_path_set(config_dir);

	err = conf_configure();
	if (err) {
		warning("zephone: configure failed: %m\n", err);
		goto out;
	}

	re_thread_async_init(ASYNC_WORKERS);

	err = baresip_init(conf_config());
	if (err) {
		warning("zephone: baresip init failed: %m\n", err);
		goto out;
	}

	if (str_isset(conf_config()->audio.audio_path))
		play_set_path(baresip_player(), conf_config()->audio.audio_path);

	err = ua_init(software, true, true, true);
	if (err)
		goto out;

	uag_set_exit_handler(ua_exit_handler, NULL);
	if (sip_trace)
		uag_enable_sip_trace(true);

	err = conf_modules();
	if (err)
		goto out;

	info("baresip v%s is ready.\n", baresip_version());
	tmr_start(&g_stop_tmr, STOP_POLL_MS, stop_poll, NULL);

	/* No signal handler: the application owns the signals. */
	err = re_main(NULL);

out:
	tmr_cancel(&g_stop_tmr);
	if (err)
		ua_stop_all(true);
	ua_close();
	module_app_unload();
	conf_close();
	baresip_close();
	mod_close();
	re_thread_async_close();
	libre_close();

	log_unregister_handler(&g_logger);
	g_log = NULL;
	atomic_store(&g_running, 0);
	return err;
}
