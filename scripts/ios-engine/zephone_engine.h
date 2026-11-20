/**
 * @file zephone_engine.h  Baresip as a library, for the iOS application.
 *
 * iOS cannot run a child process, so the engine that is an executable everywhere else (Baresip's main()) runs
 * here on a thread of the application. The application drives it exactly as it drives the executable: through the
 * `ctrl_tcp` module on the loopback interface.
 */
#ifndef ZEPHONE_ENGINE_H
#define ZEPHONE_ENGINE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Receives every line the engine logs (without the line break). Called from the engine's thread. */
typedef void (*zephone_log_fn)(uint32_t level, const char *line);

/**
 * Runs the engine until zephone_engine_stop() is called or the engine quits (the `quit` command).
 *
 * `config_dir` holds the `config` file. Only one engine runs at a time: a second call while one is running
 * fails with EBUSY. Returns 0 on a clean stop, otherwise an errno value.
 */
int zephone_engine_run(const char *config_dir, int sip_trace, zephone_log_fn log);

/** Asks the running engine to stop (any thread). zephone_engine_run() returns shortly after. */
void zephone_engine_stop(void);

/**
 * Writes the DNS servers of the active network to `out`, one address per line (an iOS application may not read
 * /etc/resolv.conf, which is where Baresip looks). Returns 0, or an errno value.
 */
int zephone_engine_dns_servers(char *out, size_t size);

/** Version of Baresip this library was built from. */
const char *zephone_engine_version(void);

#ifdef __cplusplus
}
#endif

#endif
