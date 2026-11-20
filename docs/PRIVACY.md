# Privacy and diagnostics

ZePhone reports two things, **both on by default and both optional**. A notice at the first launch tells you so and
lets you turn each one off; you can change it at any time in Settings > General > Diagnostics. **Nothing is sent
before that notice has been validated.**

## Crash reports (Sentry)

When ZePhone crashes or the interface hits an unexpected error:

- the error message and the place in the code where it happened (file and line);
- the version of ZePhone, the operating system and its architecture;
- a random identifier of the installation (see below).

A crash ends the application, so its report is written to a small file in the application folder and sent at the next
start, if crash reports are still on. Turning them off deletes what was waiting.

## Usage statistics (Google Analytics 4)

Only these events, nothing else (the list is in `src-tauri/src/telemetry/ga.rs`, and the backend refuses any other):

| Event | When | Parameters |
|---|---|---|
| `app_open` | ZePhone starts | none |
| `account_added` | a SIP account is created | `transport`: `udp`, `tcp` or `tls` |
| `call_outgoing` | a call is placed | none |
| `call_incoming` | a call arrives | none |

Each one also carries the version of ZePhone, the operating system and the random identifier. Google receives the
IP address of the request, as any server does, and may derive a rough location from it; ZePhone adds nothing to it.

## What is never sent

Phone numbers, SIP addresses and URIs, display names, e-mail addresses, passwords and tokens, IP addresses written in
a message, the name of your home folder, the content of calls, contacts, the call history and the directory.
Everything that leaves goes through one scrubbing step first (`src-tauri/src/telemetry/scrub.rs`, tested), and the
text is cut to a short length.

## The random identifier

A random number created on first use, stored in the local database. It only tells installations apart (how many
people crash, how many use the application); it is linked to no account and no person. **Settings > General >
Diagnostics > Reset** replaces it.

## How it is built

- Everything is sent from the application's backend, never from the interface: the content security policy of the
  webview stays closed.
- The identifiers of the two services are not in the repository. They come from the environment of the build
  (`ZEPHONE_SENTRY_DSN`, `ZEPHONE_GA_MEASUREMENT_ID`, `ZEPHONE_GA_API_SECRET`) or from `src-tauri/telemetry.env`
  (ignored by Git; see `telemetry.env.example`). A build without them, such as a fork's or a test run, sends nothing,
  ever. Builds made in debug mode report to the `development` environment.
- A native crash of the SIP engine itself (a segmentation fault in Baresip) is not reported: only errors of ZePhone's
  own code and of its interface are.

For the stores' privacy forms: crash reports and usage statistics can be turned off, are not linked to the user's
identity, and are not used for advertising or tracking across other applications. Note that, for users in the
European Union, analytics normally need an opt-in consent: with the current default-on choice, this is a decision
of the publisher to review with a lawyer.
