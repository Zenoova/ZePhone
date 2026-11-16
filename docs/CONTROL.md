# Global shortcuts and external control

ZePhone can be driven without bringing its window to the front: with **global keyboard shortcuts**, with the **menu bar menu**, and with the **command line** `zephone ctl` (usable from a Stream Deck, a script, Shortcuts, Alfred…).

All three go through **the same executor**, which checks that the action makes sense at that moment, picks the targeted call and calls the same functions as the interface buttons. They therefore cannot contradict each other.

## 1. Global shortcuts

_Settings → Shortcuts._ They work in all applications, including when ZePhone is minimized to the menu bar, as long as ZePhone is running.

| Action                       | Default (macOS) | What it asks for                           |
| ---------------------------- | --------------- | ------------------------------------------ |
| Answer                       | ⌥⇧⌘A            | answer the incoming call                   |
| Decline the incoming call    | ⌥⇧⌘D            | decline (603)                              |
| Hang up                      | ⌥⇧⌘H            | hang up **one** call                       |
| Mute / unmute the microphone | ⌥⇧⌘M            | toggle the microphone of the targeted call |
| Put on hold / resume         | ⌥⇧⌘P            | toggle hold on the targeted call           |
| Show the keypad              | ⌥⇧⌘N            | shows the window, ready to dial            |
| Search for a contact         | ⌥⇧⌘F            | shows the window on the directory search   |
| Do not disturb               | ⌥⇧⌘Z            | toggles "Do not disturb"                   |

For each action, the page shows its name, its combination, its scope ("Global"), its status, and lets you **edit** (captured straight from the keyboard), **remove**, **disable** or **restore** the default combination, as well as disable everything at once. Shortcuts that only work with the window in front (⌘1 to ⌘4, `/` in the directory) are listed separately.

### Shortcut statuses

| Status            | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Active**        | registered with the system: pressing it, wherever you are, runs the action                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Not activated** | the combination is saved in your settings, **but the system refused it** (invalid or reserved combination, or already taken where the system reports the conflict). It does nothing. The reason is shown. **On macOS, the system does not report that another application already uses the same combination** (observed: a second program can register the same combination without an error, and the most recent one receives the event). An "Active" shortcut that does not react may therefore be taken by another application: change it. |
| Disabled          | turned off by you; the combination is kept                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Unassigned        | no combination                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Paused            | while you are recording a combination                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### Rules

- **No bare key.** A combination includes at least Ctrl, Option/Alt or ⌘ (Shift alone does not count): a letter typed in another program must never trigger a phone action. Only F13 to F24, which nobody types by accident, are accepted alone.
- **Option/Alt alone is refused on a typing key**: it is used to write accents and symbols (on macOS); taking it globally would get in the way of typing.
- **Combinations the system keeps** (⌘Q, ⌘Tab, ⌘Space, ⌘H, ⌘M, ⌃⌘Q, ⇧⌘3/4/5; Alt+F4, Alt+Tab, Ctrl+Alt+Delete on Windows) are refused, with the reason.
- **No duplicates** between two actions, however it is written (`cmd+option+shift+a` = `CommandOrControl+Alt+Shift+A`). The message names the action that already owns the combination.
- **While a combination is being recorded, no shortcut is active**: pressing an existing combination to reuse it does not run its action. Recording stops by itself if the window loses focus or the page is left.
- **One press, one action.** A held key repeats its press; only the first counts, the next one is only taken after the release (or after two seconds without an event, if a release was lost), and never less than a quarter of a second after the previous one.
- **Release.** Changing, removing or disabling a combination releases it with the system immediately; quitting ZePhone releases all the combinations.
- **Persistence.** Preferences are saved (SQLite, key `shortcuts`) and registered with the system again at each launch.

### Permissions

**macOS: none.** Global shortcuts use the system's hot-key registration: ZePhone is only told when _one of its own combinations_ is pressed, it does not read the keyboard. No "Accessibility" or "Input Monitoring" permission is requested or needed.

If you trigger these shortcuts **from a Stream Deck** (_Hotkey_ action), it is the Stream Deck application that sends the keystrokes: macOS will ask it for _System Settings → Privacy & Security → Accessibility_. This permission concerns Stream Deck, not ZePhone, and it is unnecessary with the "Open" option described below.

Windows and Linux: the same code relies on those systems' mechanisms, **untested** (ZePhone is not built there yet). On Windows, Ctrl+Alt is equivalent to AltGr on many keyboards: prefer other combinations.

## 2. Which call is targeted?

A command can **name its call** (`--call <id>`). Otherwise, the rule is the same for shortcuts, the menu and the command line:

| Action          | Candidate calls                                                                      | Without an identifier                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Answer, Decline | **incoming** calls waiting                                                           | only one → that one. **Several → nothing is done** (ambiguous)                                                        |
| Hang up         | calls being set up or established (never a ringing incoming call: that is "Decline") | only one → that one; several → **the one that is not on hold** if it is the only one that is not; otherwise ambiguous |
| Mute            | established calls                                                                    | same                                                                                                                  |
| Hold (put on)   | established calls                                                                    | same: the active call                                                                                                 |
| Hold (resume)   | established calls                                                                    | only one → that one; several → **the one that is on hold** if it is the only one; otherwise ambiguous                 |

- **Hang up never becomes "hang up everything".** No command exists for that.
- **No candidate** → the command does nothing (state `unavailable`): "answer" without an incoming call triggers nothing else, "hold" does not touch a ringing call.
- **Ambiguous** → nothing is done. The answer lists the candidate calls so the caller can name one. From a shortcut, ZePhone comes to the front and says so in a notification.
- Requests that act on calls are handled **one at a time**: two toggles close together each read the state left by the previous one.
- The interface shows **the state confirmed by the call engine**, not the requested one. If the engine refuses, the state stays the one it confirms and the answer is `failed`.

## 3. Do not disturb

_Settings → Notifications_, shortcut, or menu bar menu. When on, every **new incoming call is declined immediately** (486 _Busy Here_), before any ringtone, window or notification. The caller hears "busy" (their server may route them to voicemail). The call appears in the history as **missed**, without a notification. Calls you make are not affected; a call that is already ringing is not declined retroactively.

## 4. External command: `zephone ctl`

The same executable as the application, started with `ctl`, talks to the instance that is **already open** and then exits. It never starts ZePhone or a second window.

```bash
Z=/Applications/ZePhone.app/Contents/MacOS/zephone

$Z ctl dial 1002                    # extension
$Z ctl dial "+33 1 23 45 67 89"     # number
$Z ctl dial sip:bob@example.com     # SIP address
$Z ctl dial 1002 --account <id>     # with a specific account (default: the default account)
$Z ctl answer                       # answer the incoming call
$Z ctl reject                       # decline it
$Z ctl hangup                       # hang up (a single call, rule above)
$Z ctl hangup --call <id>           # hang up this call
$Z ctl mute            # toggle      $Z ctl mute on   $Z ctl mute off     # explicit
$Z ctl hold            # toggle      $Z ctl hold on   $Z ctl hold off
$Z ctl dnd             # toggle      $Z ctl dnd on    $Z ctl dnd off
$Z ctl show | dialer | search       # window, keypad, contact search
$Z ctl status --pretty              # state of the application and the calls
```

Numbers, internal extensions, SIP addresses and dialing rules are **those of the application's keypad**: the same validation is applied.

**Explicit commands.** `mute on` / `mute off`, `hold on` / `hold off`, `dnd on` / `dnd off` bring the call to that state. **Repeating them changes nothing more**: `mute on` on a call that is already muted answers `ok` with `"changed": false` and sends no request to the engine. The forms without an argument (toggles) are made for the keyboard.

### Answer

One line of JSON on standard output (`--pretty` to indent it):

```json
{"status":"ok","message":"Microphone muted","changed":true,"settled":true,
 "call":{"id":"…","state":"connected","muted":true,"heldLocally":false, …}}
```

| `status`       | Exit code | Meaning                                                                  |
| -------------- | --------- | ------------------------------------------------------------------------ |
| `ok`           | 0         | accepted                                                                 |
| `failed`       | 1         | the engine refused or failed                                             |
| `invalid`      | 2         | invalid command or parameter                                             |
| `notFound`     | 3         | the named call (or account) does not exist                               |
| `ambiguous`    | 4         | several calls fit; `candidates` lists them. Nothing was done             |
| `unavailable`  | 5         | nothing to do in the current state (no incoming call, nothing on hold…)  |
| `disconnected` | 6         | ZePhone is not running, the engine is stopped or no account is connected |

**Accepted is not finished.** `settled` tells the two apart: for the microphone and hold, the answer is only sent after the engine's confirmation (`settled: true`, `call` shows the confirmed state). For answering, hanging up, declining and dialing, the engine _accepts_ the request right away but the call only changes state when the other side follows: `settled: false`. Read `ctl status` again for the final result.

`ctl status` returns, in `app`: `engineRunning`, `doNotDisturb`, `accounts` (with `connected`) and `calls` (state, `muted`, `heldLocally`, `heldRemotely`…).

### Security

- **No network port.** The command goes through a **Unix socket** (`~/Library/Application Support/app.zephone.softphone/control.sock` on macOS), mode `0600`: only your user can connect to it, and ZePhone also checks the identity of the user of each connection. A web page cannot open a Unix socket: no page can drive ZePhone, and there is no token or header to protect.
- Only the commands above exist. Nothing is executed, no file is read; an unknown field (`{"cmd":"hangup","all":true}`) is refused.
- Parameters are strictly validated (lengths, identifier characters, recipient) before reaching the engine; a request over 4 KB is refused.
- The logs record the name of the command and its result, **never the number dialed**.
- A socket left behind by a crash is replaced; a file that is not a socket is never deleted; a second instance does not steal the first one's socket.
- For a language other than the shell: one request = one line of JSON sent to the socket, one answer = one line of JSON. `ZEPHONE_CONTROL_SOCKET` replaces the path (useful if the default path exceeds the 100-byte limit).

Windows: the Unix socket does not exist; a named pipe would be the natural choice. **Not done.**

## 5. Stream Deck

Two ways, with no plugin to install.

### Option A — "Hotkey" action (the simplest)

In Stream Deck, drag **System → Hotkey** onto a key and record the action's combination (by default ⌥⇧⌘H to hang up, ⌥⇧⌘A to answer, ⌥⇧⌘M for the microphone, ⌥⇧⌘N to show the keypad). Nothing else to configure on the ZePhone side. Limits: these are **toggles** (microphone, hold), and macOS asks the Stream Deck application for the Accessibility permission.

### Option B — "Open" action + explicit command

`integrations/streamdeck/make-buttons.sh` makes a small application per action (microphone muted / active, answer, hang up, show…) that runs `zephone ctl …` and quits. No permission, no secret.

```bash
integrations/streamdeck/make-buttons.sh                       # creates ~/Documents/ZePhone Stream Deck/
integrations/streamdeck/make-buttons.sh --app /Applications/ZePhone.app --out ~/StreamDeckZePhone
```

In Stream Deck: **System → Open**, then choose the wanted application (`ZePhone - Hang up.app`, `ZePhone - Mute ON.app`, `ZePhone - Show.app`…).

Buttons created: _Answer, Decline, Hang up, Mute (toggle), Mute ON, Mute OFF, Hold (toggle), Do not disturb (toggle), Show, Dialer, Search contacts._

### What the keys show

**Stream Deck keys do not show the state of the microphone or of the call.** Stream Deck's stock actions have no way to read `ctl status`, and no plugin is provided: a crossed-out microphone icon would not know whether the microphone is really muted. To never have any doubt, use two separate keys **Mute ON** / **Mute OFF** (explicit: pressing them several times changes nothing more) and look at the window or the menu bar for the real state. A Stream Deck plugin that polled `zephone ctl status` every second could show the confirmed state; it is not written.

## 6. What is verified, and what is not

### Automated tests

| Verified                                                                                                                                                                                                                                       | Where                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Choice of the targeted call, idempotence of explicit commands, no side effect without a compatible call, two simultaneous toggles without a stale read, validation of the commands                                                             | `control::*`           |
| Answer, decline, hang up, microphone, hold, dial, "Do not disturb" on **real calls** (two real Baresip engines), state confirmed by the engine, 486 received by the caller, a second outgoing call refused while the first one is being set up | `tests/control_e2e.rs` |
| Socket: mode `0600`, refused requests (unknown command, extra field, HTTP, invalid UTF-8, too long), replacement of a stale socket, no theft of a live socket, no ordinary file deleted                                                        | `control::socket`      |
| Combinations: reading, refusal (bare key, Alt alone, reserved), duplicates, release on change/disable, kept across restarts, pause during recording, anti-repeat (held key, bounce, lost release)                                              | `shortcuts::*`         |
| Settings page: keyboard capture, no action during recording, reason for the refusal, remove, disable, restore                                                                                                                                  | component tests        |
| Control commands never read the Keychain                                                                                                                                                                                                       | handler test           |

### In the real system (packaged application, macOS, Apple Silicon)

- the application starts with a blank profile, creates the socket as `srw-------`, and **`zephone ctl status`, `answer`, `hangup`, `mute`, `hold`, `dnd` answer** with the right states and codes (`unavailable` without a call, `disconnected` while the engine starts, correct `ok`/`changed`, explicit repetitions without effect);
- **a defect was found this way and fixed**: the `status` command read the Keychain (to know whether a password exists); when macOS was waiting for an answer to its authorization window, the command no longer answered, and the application, which also read the Keychain on its main thread, no longer answered either (SIGTERM had no effect). Control commands no longer touch the Keychain and these reads no longer run on the main thread;
- the **buttons generated for Stream Deck**, launched by the system the way the "Open" action does, toggle "Do not disturb" in the real application, both ways, and **never start ZePhone** when it is closed;
- on quit, the socket is removed, no process remains (neither ZePhone nor the engine).

### Not verified

- **A shortcut pressed from another application.** During this session, the Mac was locked: the keystrokes I could send went to the login screen, not to the applications. The "system → ZePhone → action" path was therefore not exercised end to end; the "event received → action" path is, by the tests. To check in 10 seconds: open another application, press ⌥⇧⌘Z ("Do not disturb"), look at the checkbox in ZePhone's menu bar menu.
- Minimized window, held key and conflict with another application **in the real system** (all three are covered by tests of the logic, not by the system).
- A **real Stream Deck** (hardware and its software): only the launch of the generated applications is verified.
- Windows and Linux.
