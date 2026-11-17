/**
 * @file getopt.h  Minimal POSIX getopt() for Baresip's main.c on Windows (MSVC has none).
 *
 * Without it Baresip silently ignores its command line on Windows (`-f <config dir>`, `-s`, `-c`...) and would
 * read the user's own `%USERPROFILE%\.baresip` instead of the configuration ZePhone generates.
 * Supports short options only, grouped (`-sc`) or with an argument (`-f dir` / `-fdir`). Included by
 * `src/main.c` only (copied there by scripts/build-baresip.ps1).
 *
 * Copyright (C) 2026 ZePhone. BSD-3-Clause, like Baresip.
 */
#ifndef ZEPHONE_GETOPT_H
#define ZEPHONE_GETOPT_H

#include <string.h>

static char *optarg;
static int optind = 1;
static int opterr = 1;
static int optopt;

static int getopt(int argc, char *const argv[], const char *optstring)
{
	static int pos = 1;
	const char *spec;
	int c;

	optarg = NULL;
	if (optind >= argc || !argv[optind] || argv[optind][0] != '-' ||
	    !argv[optind][1])
		return -1;
	if (!strcmp(argv[optind], "--")) {
		optind++;
		return -1;
	}

	c = argv[optind][pos];
	spec = (c == ':') ? NULL : strchr(optstring, c);
	if (!spec) {
		optopt = c;
		if (!argv[optind][++pos]) {
			optind++;
			pos = 1;
		}
		return '?';
	}

	if (spec[1] == ':') {
		if (argv[optind][pos + 1]) {
			optarg = &argv[optind][pos + 1];
		}
		else if (optind + 1 < argc) {
			optarg = argv[++optind];
		}
		else {
			optopt = c;
			optind++;
			pos = 1;
			return '?';
		}
		optind++;
		pos = 1;
	}
	else if (!argv[optind][++pos]) {
		optind++;
		pos = 1;
	}

	return c;
}

#endif
