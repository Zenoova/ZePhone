# Headsets, audio devices and physical buttons

Plug in a headset, hear the calls, answer and mute the microphone without complicated settings, without ZePhone
interfering with what another application does. This document says what is done, **how it is verified** and above all
**what is not**: no real headset has been tried (see "Hardware tests to run").

## Three levels of compatibility

A headset that works for audio does not necessarily work for its buttons, and the other way round. ZePhone treats them
separately and the diagnostic (Settings → Audio → _Diagnostic_) shows them separately.

| Level          | What it is                                     | What ZePhone does                                                                                                                                   | Depends on                                                                                                                               |
| -------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Audio**   | The headset as a microphone and an output      | Any device macOS exposes (built-in, USB, Bluetooth, jack, display): list, stable identity, choice per function, tracking of plugging and unplugging | macOS alone. No driver or manufacturer software                                                                                          |
| **2. Buttons** | Answer, hang up, mute the microphone, hold     | Reads the **standard HID reports of the Telephony page** (0x0B): _Hook Switch_, _Phone Mute_, _Drop_, _Hold_. Reads nothing else                    | The headset must **declare** them. Many Bluetooth headsets do not expose them to applications (macOS keeps their call button for itself) |
| **3. Extras**  | LEDs, base state, battery, "answer by lifting" | **Not supported.** ZePhone sends no output report (LEDs) and reads neither the base nor the battery                                                 | Manufacturer-specific protocols, non-standard and not documented here                                                                    |

> A headset plugged in over USB or Bluetooth **does not prove** that its buttons work. The diagnostic lists, headset
> by headset, the buttons **the headset declares**; only a real press proves that they work.

## 1. Choosing the devices

Three separate choices: **microphone**, **conversation output**, **ringtone**. For each one:

| Choice                                     | Meaning                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| **Follow the system** (default)            | uses what macOS uses, and changes with it                                          |
| **Follow the alert output** (ringtone)     | macOS's "sound effects" output, a setting separate from the main output            |
| **A specific device**                      | the chosen headset, found again by its **system identifier** (UID) at each plug-in |
| **Backup device** (with a specific choice) | used when the chosen device is absent                                              |

- **The device actually in use is shown**, not only the one requested: "In use: …" with the way it was obtained
  (follows the system / explicit choice / backup / system default for lack of the choice). What is shown is **what the
  audio engine confirmed**; if the engine refuses a change, the previous device stays shown, with the refusal.
- **A saved choice that is absent** is flagged ("not plugged in") and **never erased**: the same headset coming back is
  reused by itself.
- **Two identical headsets are never confused**: a choice is found by identifier; another device with the same name is
  another device. A choice saved before ZePhone remembered identifiers (by name alone) is only found again if **a single**
  device carries that name, then completed with the identifier. If a headset's identifier changes (some do when changing
  port), choose it again.
- The audio engine (Baresip) chooses by **name**: two devices with the same name, or a name with a comma, `#` or too
  long, are flagged as unreliable.
- **macOS has no "communications" device** distinct from the default device (Windows has one).
  ZePhone says so in the settings instead of simulating it.
- **The ringtone has its own device**: Baresip's `auplay` command also moves the ringtone to the conversation device;
  a small addition to the `zeaudio` module (`zealert`) puts it back on its device after each change, without
  restarting the engine.
- **During a call**, the microphone button of the call bar opens quick access: readable names, the device in use
  checked, a "Mic on / muted" indicator, a choice for **this call** or to keep.

## 2. Plugging and unplugging

macOS reports device additions, removals and default changes; ZePhone listens to them (CoreAudio).

- **A single plug-in often causes several notifications**: ZePhone waits **0.5 s of calm** and looks only once
  (tested: 20 notifications → 1 evaluation).
- **Outside a call**: the engine follows right away what the choice gives.
- **During a call, if the device in use disappears**:
  1. **the SIP session stays open**, the call is never cut;
  2. a **2.5 s grace period** lets a device that only blinked (Bluetooth) come back;
  3. then, according to the chosen rule: **Ask me** · **Backup device** (default; otherwise we ask) ·
     **System default**;
  4. **the conversation never moves by itself to public speakers** (the computer's speakers, a display's)
     **without explicit permission** (a separate setting, off by default): this is said and the choice is offered.
     This is the typical case of a Bluetooth headset that disconnects: macOS then switches to the Mac's
     speakers;
  5. a **banner** on the call screen says immediately what happened, with "Choose another device".
- **A role that follows the system goes where the system goes** (that is what it asks for), with the same protection for
  public speakers.
- **Mute and hold are kept** across a change: the muted microphone is sent to the engine again after each
  change; hold is a SIP state that an audio change does not touch.
- **A change refused by the engine** gives a clear state ("could not be used", previous device
  kept), is not retried in a loop, and is retried as soon as the situation or the settings change. A new choice
  works immediately (recovery).
- **Sleep / wake, loss of Bluetooth**: macOS re-enumerates the devices, ZePhone re-evaluates. **Not verified on
  hardware** (see below).

## 3. Headset buttons

The chain has three separate stages: **the source** (what the hardware says) → **the interpreter** (what it means, given
the real state of the calls) → the common **executor** (the same one as the keyboard shortcuts and the command line, which
picks the call by the rule documented in [`CONTROL.md`](CONTROL.md)).

| Button (HID Telephony)                      | What ZePhone does with it                                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| _Hook Switch_ (call button) goes "off hook" | **Answers the ringing incoming call.** Nothing else: never dials, never acts on a call in progress                           |
| _Hook Switch_ goes "on hook"                | **Hangs up the call in progress or being set up.** **Never** a decline of a ringing call, never anything if there is no call |
| _Phone Mute_                                | Toggles the call's microphone (**short** press, acts on release)                                                             |
| _Drop_                                      | Hangs up the call in progress                                                                                                |
| _Hold_                                      | Toggles hold on an established call                                                                                          |
| _Flash_, everything else                    | Ignored                                                                                                                      |

Safeguards (all tested, see below):

- **Duplicates**: the same report twice within 150 ms is a single event; a repeated hook state is not a
  change.
- **Long press**: a press longer than 800 ms (adjustable) is **ignored**, never taken for a short press.
- **According to the real state**: an action only happens if it makes sense (nothing to answer = nothing). Without a ZePhone call,
  **no button does anything**, whatever another application does.
- **Several calls**: the executor's rule — two ringing calls are **not** guessed (nothing is done, the
  diagnostic says so); microphone, hold and hang up target the active call.
- **Base, charging, connection**: these are not standard HID reports and ZePhone does not read them; they can
  therefore never be taken for an order to answer, decline or hang up. A headset that announced its base _through the
  standard hook_ would cause an "on hook": that is a hang up, never a decline.
- **"Answer by lifting the headset"**: no standard mechanism tells "lifted" from "button pressed";
  it is only offered as the call button (setting **The call button answers**, can be turned off), and the
  manufacturer's sensor-based detection does not exist here.
- **Everything can be turned off without touching the audio**: _Disabled_ mode, or each action separately.
- **Handling mode**: _Automatic_, _Standard system controls_, _Vendor integration_, _Disabled_.
  No vendor integration is included (none was verified in its official documentation): this choice
  is shown as unavailable and handles no button. There is **only one active mechanism**: the same button
  cannot be handled twice.
- **Only the headset in use**: the buttons of another headset, or of a headset ZePhone does not use, are
  ignored (matched by the name the headset announces and the name of the audio device).

## 4. Microphone: requested, confirmed, honest

- The interface shows **the state confirmed by the call engine**, never the requested one. All the paths (interface
  button, keyboard shortcut, external command, headset button) go through the same executor and the same
  call manager function.
- **No loop**: ZePhone sends no report to the headset (no LED), so a software change never
  causes a hardware event that would reverse it.
- **Hardware mute**: if the headset has a hardware microphone switch, ZePhone **can neither control nor
  observe it**: the "Mic muted" indicator does not reflect it. This is written in the settings.
- **LEDs**: not supported (level 3). No LED would suggest a state ZePhone does not know.

## 5. Teams and other applications

- ZePhone **only acts on the buttons if it has a call itself** (ringing or in progress). Open without a call, it
  reacts to nothing.
- **It does not hog the headset**: its HID reads do not take the device exclusively, so Teams and the
  system keep receiving the same reports. **It cannot stop Teams from reacting either**: macOS
  does not assign a headset's buttons to a specific application.
- **ZePhone does not know** whether Teams (or another application) has a call in progress: no system information says so, and it
  neither claims to detect it nor to control it. The diagnostic only shows that a device is "used by an
  application" (without saying which).
- **Simple workaround**: close the other calling application, or choose _Disabled_ in one of the two (for
  example ZePhone's _Disabled_ mode, while keeping the headset audio).

## 6. USB and Bluetooth

- A single headset often exposes **several devices** (an output, an input, sometimes two Bluetooth profiles):
  the list shows them separately with their connection type.
- **Bluetooth**: using a Bluetooth headset's microphone switches it to the "hands-free" profile (lower
  fidelity sound). ZePhone explains this when the device in use is a Bluetooth headset; it is a constraint of
  Bluetooth, not something the application fixes.
- The presence of a USB adapter or a Bluetooth connection **says nothing** about the buttons: the diagnostic lists what
  each headset declares.
- ZePhone forces no format: it opens the devices as the system and the audio engine accept them.

## 7. Audio diagnostic

_Settings → Audio → Diagnostic._

- the detected devices (connection type, input/output, system default, public speaker, used by
  an application, used by ZePhone and for what);
- what ZePhone uses for each function, with the problems in plain words (absent device, ambiguous name…) and the
  engine's refusals;
- the **microphone permission** (allowed, denied, restricted) with access to the system settings;
- **tests started by you**: a tone on the output, a real ringtone on the ringtone output, the live microphone level.
  They play **directly on the device**, never in a call: your correspondent does not hear them. They are **disabled
  during a call**. No test recording is made;
- the state of button reading (active, permission needed, unavailable), the headsets that expose standard
  buttons **with the buttons they declare**, and the last 25 events with what they became
  ("No incoming call to answer", "Long press ignored", "Microphone muted (done)"…).

**"Input Monitoring" permission**: ZePhone only opens the devices of the Telephony page (never a keyboard or a
mouse). If macOS asks for a permission anyway, the diagnostic says so and indicates where to grant it; without it, the headset's
audio works but not its buttons.

## 8. What is verified, and how

### Automated tests (simulations of the logic, **not** hardware tests)

| Verified                                                                                                                                                                                                                                                   | Where                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Device choice per role, following the system, explicit choice, backup, return of the same headset, two identical headsets never confused, choices saved by name, unreliable names                                                                          | `audio::routing`                     |
| During a call: headset that disappears, grace period, backup, refusal of public speakers, following the system, microphone not subject to the rule                                                                                                         | `audio::routing`, `audio::router`    |
| State machine: nothing is done twice, a refused change is not retried, the user's choice holds until the end of the call, the ringtone is never changed during a call, burst of notifications = one evaluation, muted microphone sent again after a change | `audio::router`                      |
| Button interpretation: duplicates, hook, short/long press, never a decline from the base or the hook, nothing without a call, per-action disabling, unused headset ignored                                                                                 | `headset::tests`                     |
| Buttons → real executor: call chosen by the rule, two ringing calls not guessed, nothing without a call                                                                                                                                                    | `headset::service`                   |
| Migration of the old choices by name, engine state, muted microphone kept                                                                                                                                                                                  | `database::settings`, `sip::manager` |
| Settings, quick access in a call, incident banner, diagnostic (tests refused in a call, permission, declared buttons)                                                                                                                                      | interface tests                      |

### Real Baresip engine and real calls (synthetic audio, no hardware)

`tests/audio_e2e.rs`, two real engines, real calls, signal measurement:

- changing the **microphone** in the middle of a call: the SIP session stays open; **muted before the change, it stays muted**
  (silence measured on the other side); unmute: the other side hears the **new** source, not the old one;
- changing the **output**: what is heard does arrive on the **new** device;
- **hold**: a call on hold stays on hold during a change, then resumes on the new devices;
- an unknown device is refused without cutting the call, and a good change afterwards works (**recovery**).

`tests/engine_integration.rs`: all the devices CoreAudio lists on this machine are accepted by the
real engine, including the `zealert` command (ringtone) and an output change that does not overwrite it.

### In the real system (packaged application, macOS 26, Apple Silicon MacBook Pro, built-in devices)

- **real CoreAudio**: list of 3 devices (built-in microphone and speakers, a virtual microphone), connection
  type, system defaults; all accepted by the real engine;
- **a device that appears then disappears on the real system**: a temporary aggregate device is created
  then destroyed (a real change of the list, without touching any setting or default device); the packaged
  application sees it appear (3 → 4 devices) then disappear (4 → 3), **one evaluation per burst**;
- **real HID reading**: starts and stops cleanly; no Telephony device is plugged in here, so
  no button detection was exercised;
- the packaged application starts, the engine starts on the devices the choice gives, the control commands
  answer.

## 9. The ten risky situations

| #   | Situation                                                    | State                                                                                                                                                                             |
| --- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Headset plugged in before / after launch                     | logic, real list and appearance of a device after launch **on the real system** tested; **not with a headset**                                                                    |
| 2   | Unplugging and reconnecting during a call                    | logic + device change in a real call tested (synthetic); **not with a headset**                                                                                                   |
| 3   | Change of the system's default device                        | logic tested, and the system notification is seen on a real list change; the change of the **default** itself **was not tried** (it would modify a system setting of the machine) |
| 4   | Muted microphone kept across a change                        | **tested on a real call** (silence measured)                                                                                                                                      |
| 5   | Buttons with the application in the background               | HID reading runs on its own thread, independently of the window; **no headset to try it**                                                                                         |
| 6   | No double action if the event arrives through two mechanisms | a single active mechanism; duplicates tested                                                                                                                                      |
| 7   | No automatic rejection when the headset rests on its base    | **tested** (interpreter); the base is not read anyway                                                                                                                             |
| 8   | Right call selected with several calls                       | **tested** (executor's rule)                                                                                                                                                      |
| 9   | Teams or another application also uses the headset           | **cannot be verified here**; behavior documented above                                                                                                                            |
| 10  | Recovery after sleep or Bluetooth loss                       | logic tested; **not tried on hardware**                                                                                                                                           |

## Hardware tests to run

No headset has been tried: the development machine only has the built-in devices. For each test,
write down the **model, macOS version, connection type (USB, Bluetooth, jack, adapter), functions verified**. Do not
deduce the compatibility of a whole brand from a single model.

1. Plug in the headset (USB) **before** then **after** launch: it appears in the diagnostic, the explicit choice
   finds it again.
2. Diagnostic → declared buttons: which ones? Press each one and read the event log.
3. Incoming call: does the call button answer? Does a second press hang up? Does the mute button toggle ZePhone's
   microphone? Is there also a hardware mute that the indicator does not reflect?
4. Call in progress, **unplug** the headset: banner, call still open, nothing moved to the speakers;
   plug it back in: back on the headset?
5. Same test over **Bluetooth**: does the microphone switch to the hands-free profile? Does macOS switch to the speakers?
   Does ZePhone refuse to follow without permission?
6. Headset on its **base** / removed from the base during a ringing call: nothing must be declined.
7. **Teams** open with the same headset: who reacts to the buttons? (Both, expected.) Does the workaround work?
8. **Sleep** of the Mac during a call then wake; **Bluetooth loss** then return.
9. Change the default device in System Settings during a call (role that follows the system).
10. Two identical headsets: the choice of the first is not taken for the second.
