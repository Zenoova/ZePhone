//! What audio devices the system has, with an identity that survives a reconnection.
//!
//! The name of a device is not an identity (two identical headsets share one, a renamed device loses it): the
//! system's own unique identifier (`uid`) is. The SIP engine, however, selects devices by name, so the name is
//! kept too, and a device whose name the engine could not select is flagged.

use std::sync::Arc;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Transport {
    BuiltIn,
    Usb,
    Bluetooth,
    /// A screen or a TV (HDMI, DisplayPort): its speakers are in the room.
    Display,
    /// Software (loopback drivers, aggregate devices).
    Virtual,
    Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    /// The system's unique identifier: stable across reconnections.
    pub uid: String,
    pub name: String,
    pub transport: Transport,
    /// Number of input / output channels (0 = not an input / not an output).
    pub input_channels: u32,
    pub output_channels: u32,
    pub alive: bool,
    /// The output is a loudspeaker other people in the room hear (laptop speakers, a screen).
    pub public_speaker: bool,
    /// Some application is using this device right now (which one is not known).
    pub in_use_elsewhere: bool,
    /// The engine can select this device by its name.
    pub selectable: bool,
    /// Another device has the same name: the engine cannot tell them apart.
    pub duplicate_name: bool,
}

impl DeviceInfo {
    pub fn is_input(&self) -> bool {
        self.input_channels > 0
    }
    pub fn is_output(&self) -> bool {
        self.output_channels > 0
    }
}

/// The devices and the system's choices, at one moment.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub devices: Vec<DeviceInfo>,
    pub default_input: Option<String>,
    pub default_output: Option<String>,
    /// The output the system plays alerts and sound effects on (a separate setting on macOS).
    pub alert_output: Option<String>,
}

impl Snapshot {
    pub fn find(&self, uid: &str) -> Option<&DeviceInfo> {
        self.devices.iter().find(|d| d.uid == uid)
    }
}

/// Keeps watching until dropped.
pub trait Watch: Send {}

pub trait AudioSystem: Send + Sync + 'static {
    fn snapshot(&self) -> Snapshot;
    /// Calls `notify` (from any thread, possibly often) whenever the devices or the system's choices change.
    fn watch(&self, notify: Arc<dyn Fn() + Send + Sync>) -> Option<Box<dyn Watch>>;
    /// The system can follow a separate "communication" device (Windows). macOS has no such notion.
    fn supports_communication_default(&self) -> bool {
        false
    }
}

/// Whether the engine can select a device with this name (its config syntax cannot express every name).
pub fn is_selectable(name: &str) -> bool {
    !name.is_empty()
        && name.len() < 64
        && !name.contains([',', '#'])
        && !name.chars().any(char::is_control)
}

/// Marks the devices that share a name with another one.
pub fn mark_duplicates(devices: &mut [DeviceInfo]) {
    let names: Vec<String> = devices.iter().map(|d| d.name.clone()).collect();
    for d in devices.iter_mut() {
        d.duplicate_name = names.iter().filter(|n| **n == d.name).count() > 1;
    }
}

#[cfg(target_os = "macos")]
pub use macos::CoreAudio as SystemAudio;

#[cfg(not(target_os = "macos"))]
pub use other::CpalAudio as SystemAudio;

#[cfg(target_os = "macos")]
mod macos {
    use std::{ffi::c_void, ptr};

    use core_foundation::{base::TCFType, string::CFString};

    use super::*;

    type Id = u32;
    type OsStatus = i32;

    #[repr(C)]
    struct Address {
        selector: u32,
        scope: u32,
        element: u32,
    }

    type ListenerProc = extern "C" fn(Id, u32, *const Address, *mut c_void) -> OsStatus;

    #[link(name = "CoreAudio", kind = "framework")]
    unsafe extern "C" {
        fn AudioObjectGetPropertyDataSize(
            id: Id,
            address: *const Address,
            qualifier_size: u32,
            qualifier: *const c_void,
            size: *mut u32,
        ) -> OsStatus;
        fn AudioObjectGetPropertyData(
            id: Id,
            address: *const Address,
            qualifier_size: u32,
            qualifier: *const c_void,
            size: *mut u32,
            data: *mut c_void,
        ) -> OsStatus;
        fn AudioObjectAddPropertyListener(
            id: Id,
            address: *const Address,
            listener: ListenerProc,
            client: *mut c_void,
        ) -> OsStatus;
        fn AudioObjectRemovePropertyListener(
            id: Id,
            address: *const Address,
            listener: ListenerProc,
            client: *mut c_void,
        ) -> OsStatus;
    }

    const fn fourcc(s: &[u8; 4]) -> u32 {
        u32::from_be_bytes(*s)
    }

    const SYSTEM_OBJECT: Id = 1;
    const GLOBAL: u32 = fourcc(b"glob");
    const INPUT: u32 = fourcc(b"inpt");
    const OUTPUT: u32 = fourcc(b"outp");
    const MAIN: u32 = 0;

    const DEVICES: u32 = fourcc(b"dev#");
    const DEFAULT_INPUT: u32 = fourcc(b"dIn ");
    const DEFAULT_OUTPUT: u32 = fourcc(b"dOut");
    const DEFAULT_SYSTEM_OUTPUT: u32 = fourcc(b"sOut");
    const NAME: u32 = fourcc(b"lnam");
    const UID: u32 = fourcc(b"uid ");
    const TRANSPORT: u32 = fourcc(b"tran");
    const STREAM_CONFIG: u32 = fourcc(b"slay");
    const ALIVE: u32 = fourcc(b"livn");
    const RUNNING_SOMEWHERE: u32 = fourcc(b"gone");
    const DATA_SOURCE: u32 = fourcc(b"ssrc");

    fn addr(selector: u32, scope: u32) -> Address {
        Address {
            selector,
            scope,
            element: MAIN,
        }
    }

    unsafe fn get_u32(id: Id, selector: u32, scope: u32) -> Option<u32> {
        let a = addr(selector, scope);
        let mut v: u32 = 0;
        let mut size = 4u32;
        // SAFETY: `v` is a 4-byte buffer and `size` says so.
        let st = unsafe {
            AudioObjectGetPropertyData(
                id,
                &a,
                0,
                ptr::null(),
                &mut size,
                (&mut v as *mut u32).cast(),
            )
        };
        (st == 0 && size == 4).then_some(v)
    }

    unsafe fn get_string(id: Id, selector: u32) -> Option<String> {
        let a = addr(selector, GLOBAL);
        let mut s: *const c_void = ptr::null();
        let mut size = std::mem::size_of::<*const c_void>() as u32;
        // SAFETY: the system hands back one retained CFString reference.
        let st = unsafe {
            AudioObjectGetPropertyData(
                id,
                &a,
                0,
                ptr::null(),
                &mut size,
                (&mut s as *mut *const c_void).cast(),
            )
        };
        if st != 0 || s.is_null() {
            return None;
        }
        // SAFETY: "Copy"/"Create" rule: we own this reference and release it when the wrapper drops.
        let cf = unsafe { CFString::wrap_under_create_rule(s.cast()) };
        Some(cf.to_string())
    }

    /// Total channels of a device in one direction.
    unsafe fn channels(id: Id, scope: u32) -> u32 {
        let a = addr(STREAM_CONFIG, scope);
        let mut size = 0u32;
        // SAFETY: plain size query.
        if unsafe { AudioObjectGetPropertyDataSize(id, &a, 0, ptr::null(), &mut size) } != 0
            || size < 8
        {
            return 0;
        }
        let mut buf = vec![0u8; size as usize];
        // SAFETY: `buf` is `size` bytes long.
        if unsafe {
            AudioObjectGetPropertyData(id, &a, 0, ptr::null(), &mut size, buf.as_mut_ptr().cast())
        } != 0
        {
            return 0;
        }
        // AudioBufferList: a count, then (with the padding the pointer needs) that many 16-byte AudioBuffers
        // whose first field is the channel count.
        let n = u32::from_ne_bytes(buf[0..4].try_into().unwrap()) as usize;
        (0..n)
            .filter_map(|i| buf.get(8 + i * 16..12 + i * 16))
            .map(|b| u32::from_ne_bytes(b.try_into().unwrap()))
            .sum()
    }

    fn transport_of(code: u32) -> Transport {
        match &code.to_be_bytes() {
            b"bltn" => Transport::BuiltIn,
            b"usb " => Transport::Usb,
            b"blue" | b"blea" => Transport::Bluetooth,
            b"hdmi" | b"dprt" => Transport::Display,
            b"virt" | b"aggr" | b"grup" => Transport::Virtual,
            _ => Transport::Other,
        }
    }

    unsafe fn device_ids() -> Vec<Id> {
        let a = addr(DEVICES, GLOBAL);
        let mut size = 0u32;
        // SAFETY: plain size query on the system object.
        if unsafe { AudioObjectGetPropertyDataSize(SYSTEM_OBJECT, &a, 0, ptr::null(), &mut size) }
            != 0
        {
            return vec![];
        }
        let mut ids = vec![0u32; size as usize / 4];
        // SAFETY: `ids` holds `size` bytes.
        if unsafe {
            AudioObjectGetPropertyData(
                SYSTEM_OBJECT,
                &a,
                0,
                ptr::null(),
                &mut size,
                ids.as_mut_ptr().cast(),
            )
        } != 0
        {
            return vec![];
        }
        ids.truncate(size as usize / 4);
        ids
    }

    unsafe fn device(id: Id) -> Option<DeviceInfo> {
        // SAFETY (all calls): `id` is a device the system just listed; every call checks its own status.
        unsafe {
            let uid = get_string(id, UID)?;
            let name = get_string(id, NAME)?;
            let input_channels = channels(id, INPUT);
            let output_channels = channels(id, OUTPUT);
            if input_channels == 0 && output_channels == 0 {
                return None;
            }
            let transport = get_u32(id, TRANSPORT, GLOBAL)
                .map(transport_of)
                .unwrap_or(Transport::Other);
            // The built-in output is one device whose "data source" says whether the speakers or the headphone
            // jack are in use: only the speakers are heard by the room.
            let source = get_u32(id, DATA_SOURCE, OUTPUT).map(|c| c.to_be_bytes());
            let speakers = match source {
                Some(s) => &s == b"ispk",
                None => name.to_lowercase().contains("speaker"),
            };
            let public_speaker = output_channels > 0
                && match transport {
                    Transport::BuiltIn => speakers,
                    Transport::Display => true,
                    _ => false,
                };
            let running = get_u32(id, RUNNING_SOMEWHERE, GLOBAL).unwrap_or(0) != 0;
            Some(DeviceInfo {
                selectable: is_selectable(&name),
                uid,
                name,
                transport,
                input_channels,
                output_channels,
                alive: get_u32(id, ALIVE, GLOBAL).unwrap_or(1) != 0,
                public_speaker,
                in_use_elsewhere: running,
                duplicate_name: false,
            })
        }
    }

    unsafe fn default_uid(selector: u32) -> Option<String> {
        // SAFETY: reads one device id from the system object, then asks that device for its uid.
        unsafe {
            let id = get_u32(SYSTEM_OBJECT, selector, GLOBAL)?;
            if id == 0 {
                return None;
            }
            get_string(id, UID)
        }
    }

    pub struct CoreAudio;

    impl AudioSystem for CoreAudio {
        fn snapshot(&self) -> Snapshot {
            // SAFETY: only reads properties of the system object and of the devices it lists.
            unsafe {
                let mut devices: Vec<DeviceInfo> =
                    device_ids().into_iter().filter_map(|i| device(i)).collect();
                mark_duplicates(&mut devices);
                devices.sort_by(|a, b| {
                    a.name
                        .to_lowercase()
                        .cmp(&b.name.to_lowercase())
                        .then(a.uid.cmp(&b.uid))
                });
                Snapshot {
                    devices,
                    default_input: default_uid(DEFAULT_INPUT),
                    default_output: default_uid(DEFAULT_OUTPUT),
                    alert_output: default_uid(DEFAULT_SYSTEM_OUTPUT),
                }
            }
        }

        fn watch(&self, notify: Arc<dyn Fn() + Send + Sync>) -> Option<Box<dyn Watch>> {
            extern "C" fn on_change(
                _: Id,
                _: u32,
                _: *const Address,
                client: *mut c_void,
            ) -> OsStatus {
                // SAFETY: `client` is the `Box<Arc<..>>` leaked below, alive until the guard removes the listener.
                let notify = unsafe { &*(client as *const Arc<dyn Fn() + Send + Sync>) };
                notify();
                0
            }
            let client = Box::into_raw(Box::new(notify)) as *mut c_void;
            let selectors = [
                DEVICES,
                DEFAULT_INPUT,
                DEFAULT_OUTPUT,
                DEFAULT_SYSTEM_OUTPUT,
            ];
            let mut added = Vec::new();
            for s in selectors {
                let a = addr(s, GLOBAL);
                // SAFETY: the callback is a plain function and `client` outlives the registration.
                if unsafe { AudioObjectAddPropertyListener(SYSTEM_OBJECT, &a, on_change, client) }
                    == 0
                {
                    added.push(s);
                }
            }
            if added.is_empty() {
                // SAFETY: nothing registered: reclaim the box.
                drop(unsafe { Box::from_raw(client as *mut Arc<dyn Fn() + Send + Sync>) });
                return None;
            }
            struct Guard {
                selectors: Vec<u32>,
                client: *mut c_void,
                on_change: ListenerProc,
            }
            // SAFETY: the pointer is only used to unregister and free, once, in `drop`.
            unsafe impl Send for Guard {}
            impl Watch for Guard {}
            impl Drop for Guard {
                fn drop(&mut self) {
                    for s in &self.selectors {
                        let a = addr(*s, GLOBAL);
                        // SAFETY: removes exactly what was added with the same callback and client.
                        unsafe {
                            AudioObjectRemovePropertyListener(
                                SYSTEM_OBJECT,
                                &a,
                                self.on_change,
                                self.client,
                            )
                        };
                    }
                    // SAFETY: the listeners are gone, so nothing can use the box any more.
                    drop(unsafe { Box::from_raw(self.client as *mut Arc<dyn Fn() + Send + Sync>) });
                }
            }
            Some(Box::new(Guard {
                selectors: added,
                client,
                on_change,
            }))
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod other {
    use cpal::traits::{DeviceTrait, HostTrait};

    use super::*;

    /// Without a native source the names are the identities, and nothing is watched.
    pub struct CpalAudio;

    impl AudioSystem for CpalAudio {
        fn snapshot(&self) -> Snapshot {
            let host = cpal::default_host();
            let name = |d: &cpal::Device| d.description().ok().map(|d| d.name().to_owned());
            let mut devices: Vec<DeviceInfo> = Vec::new();
            for (list, input) in [(host.input_devices(), true), (host.output_devices(), false)] {
                for d in list.into_iter().flatten() {
                    let Some(n) = name(&d) else { continue };
                    match devices.iter_mut().find(|x| x.uid == n) {
                        Some(x) if input => x.input_channels = 1,
                        Some(x) => x.output_channels = 1,
                        None => devices.push(DeviceInfo {
                            uid: n.clone(),
                            selectable: is_selectable(&n),
                            name: n,
                            transport: Transport::Other,
                            input_channels: input as u32,
                            output_channels: (!input) as u32,
                            alive: true,
                            public_speaker: false,
                            in_use_elsewhere: false,
                            duplicate_name: false,
                        }),
                    }
                }
            }
            Snapshot {
                default_input: host.default_input_device().and_then(|d| name(&d)),
                default_output: host.default_output_device().and_then(|d| name(&d)),
                alert_output: host.default_output_device().and_then(|d| name(&d)),
                devices,
            }
        }
        fn watch(&self, _: Arc<dyn Fn() + Send + Sync>) -> Option<Box<dyn Watch>> {
            None
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn dev(
        uid: &str,
        name: &str,
        transport: Transport,
        inputs: u32,
        outputs: u32,
    ) -> DeviceInfo {
        DeviceInfo {
            uid: uid.into(),
            name: name.into(),
            transport,
            input_channels: inputs,
            output_channels: outputs,
            alive: true,
            public_speaker: transport == Transport::BuiltIn && outputs > 0,
            in_use_elsewhere: false,
            selectable: is_selectable(name),
            duplicate_name: false,
        }
    }

    #[test]
    fn names_the_engine_cannot_select_are_flagged() {
        assert!(is_selectable("MacBook Pro Microphone"));
        assert!(!is_selectable("Weird, Name"));
        assert!(!is_selectable("Hash # name"));
        assert!(!is_selectable(""));
        assert!(!is_selectable(&"x".repeat(80)));
    }

    #[test]
    fn two_devices_with_one_name_are_marked() {
        let mut v = vec![
            dev("a", "USB Headset", Transport::Usb, 1, 2),
            dev("b", "USB Headset", Transport::Usb, 1, 2),
            dev("c", "Other", Transport::Usb, 1, 0),
        ];
        mark_duplicates(&mut v);
        assert!(v[0].duplicate_name && v[1].duplicate_name && !v[2].duplicate_name);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn reads_the_real_devices_of_this_machine() {
        let s = SystemAudio.snapshot();
        println!("devices: {}", s.devices.len());
        for d in &s.devices {
            println!(
                "{} | {} | {:?} | in {} out {} | public {}",
                d.uid, d.name, d.transport, d.input_channels, d.output_channels, d.public_speaker
            );
            assert!(!d.uid.is_empty() && !d.name.is_empty());
            assert!(d.is_input() || d.is_output());
        }
        // Every default the system names is a device in the list.
        for uid in [&s.default_input, &s.default_output, &s.alert_output]
            .into_iter()
            .flatten()
        {
            assert!(s.find(uid).is_some(), "default {uid} not listed");
        }
    }
}
