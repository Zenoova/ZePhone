//! Reading headset buttons on macOS: the HID Telephony page, through IOKit's HID manager.
//!
//! * Only devices whose top-level collection is the Telephony page (0x0B) are matched. Keyboards, mice and
//!   everything else are never opened, which is also why this needs no "Input Monitoring" permission for them.
//! * Devices are opened **without** seizing them: other applications (Teams, the system) keep receiving the same
//!   reports. ZePhone neither takes the buttons from them nor can it stop them from reacting too.
//! * If the system does refuse to open a device (a permission it asks the user for), that is reported as such.
//!
//! This file talks to the operating system and is verified with real headsets only (see docs/HEADSETS.md); the
//! interpretation of what it reports is tested without hardware in `headset::tests`.

use std::{
    ffi::c_void,
    sync::{Arc, mpsc},
    thread::JoinHandle,
    time::Instant,
};

use core_foundation::{
    array::CFArray,
    base::{CFGetTypeID, CFRelease, CFTypeRef, TCFType},
    dictionary::CFDictionary,
    number::CFNumber,
    runloop::{CFRunLoop, kCFRunLoopDefaultMode},
    string::CFString,
};

use super::{
    HidInput, Usage,
    service::{HidDevice, Reading},
};

type Manager = *mut c_void;
type Device = *mut c_void;
type Element = *mut c_void;
type Value = *mut c_void;
type IoReturn = i32;
type DeviceCallback = extern "C" fn(*mut c_void, IoReturn, *mut c_void, Device);
type ValueCallback = extern "C" fn(*mut c_void, IoReturn, *mut c_void, Value);

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOHIDManagerCreate(allocator: *const c_void, options: u32) -> Manager;
    fn IOHIDManagerSetDeviceMatchingMultiple(manager: Manager, multiple: *const c_void);
    fn IOHIDManagerRegisterDeviceMatchingCallback(
        manager: Manager,
        cb: DeviceCallback,
        ctx: *mut c_void,
    );
    fn IOHIDManagerRegisterDeviceRemovalCallback(
        manager: Manager,
        cb: DeviceCallback,
        ctx: *mut c_void,
    );
    fn IOHIDManagerRegisterInputValueCallback(
        manager: Manager,
        cb: ValueCallback,
        ctx: *mut c_void,
    );
    fn IOHIDManagerScheduleWithRunLoop(
        manager: Manager,
        run_loop: *const c_void,
        mode: *const c_void,
    );
    fn IOHIDManagerUnscheduleFromRunLoop(
        manager: Manager,
        run_loop: *const c_void,
        mode: *const c_void,
    );
    fn IOHIDManagerOpen(manager: Manager, options: u32) -> IoReturn;
    fn IOHIDManagerClose(manager: Manager, options: u32) -> IoReturn;
    fn IOHIDDeviceGetProperty(device: Device, key: *const c_void) -> CFTypeRef;
    fn IOHIDDeviceCopyMatchingElements(
        device: Device,
        matching: *const c_void,
        options: u32,
    ) -> *const c_void;
    fn IOHIDElementGetUsagePage(element: Element) -> u32;
    fn IOHIDElementGetUsage(element: Element) -> u32;
    fn IOHIDElementGetType(element: Element) -> u32;
    fn IOHIDElementGetDevice(element: Element) -> Device;
    fn IOHIDValueGetElement(value: Value) -> Element;
    fn IOHIDValueGetIntegerValue(value: Value) -> isize;
}

/// `kIOReturnNotPermitted`: the system wants the user's permission first.
const NOT_PERMITTED: u32 = 0xE000_02E2;
/// Input element types (misc, button, axis, scan codes); outputs, features and collections are above.
const LAST_INPUT_TYPE: u32 = 4;

#[derive(Debug, Clone, PartialEq)]
pub enum HidMessage {
    Reading(Reading),
    Attached(HidDevice),
    Detached(String),
    Input(HidInput),
}

type Emit = Arc<dyn Fn(HidMessage) + Send + Sync>;

/// Listens until dropped.
pub struct HidMonitor {
    run_loop: Option<CFRunLoopHandle>,
    thread: Option<JoinHandle<()>>,
}

struct CFRunLoopHandle(CFRunLoop);
// SAFETY: a run loop reference may be used from any thread to ask it to stop, which is all that is done.
unsafe impl Send for CFRunLoopHandle {}

impl HidMonitor {
    pub fn start(emit: Emit) -> Self {
        let (tx, rx) = mpsc::channel::<Option<CFRunLoopHandle>>();
        let thread = std::thread::Builder::new()
            .name("zephone-hid".into())
            .spawn(move || run(emit, tx))
            .ok();
        let run_loop = rx.recv().ok().flatten();
        Self { run_loop, thread }
    }
}

impl Drop for HidMonitor {
    fn drop(&mut self) {
        if let Some(rl) = self.run_loop.take() {
            rl.0.stop();
        }
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

fn run(emit: Emit, started: mpsc::Sender<Option<CFRunLoopHandle>>) {
    // SAFETY: every IOKit object below is created, used and released on this thread, except the callbacks,
    // which IOKit calls on this same thread's run loop.
    unsafe {
        let manager = IOHIDManagerCreate(std::ptr::null(), 0);
        if manager.is_null() {
            emit(HidMessage::Reading(Reading::Unavailable {
                message: "The system could not open the reading of HID devices".into(),
            }));
            let _ = started.send(None);
            return;
        }

        // Only the Telephony page: headsets, handsets, call controllers.
        let page = CFDictionary::from_CFType_pairs(&[(
            CFString::from_static_string("DeviceUsagePage"),
            CFNumber::from(Usage::TELEPHONY_PAGE as i32),
        )]);
        let matching = CFArray::from_CFTypes(&[page]);
        IOHIDManagerSetDeviceMatchingMultiple(
            manager,
            matching.as_concrete_TypeRef() as *const c_void,
        );

        // The callbacks get this box; it lives until after the manager is closed.
        let ctx = Box::into_raw(Box::new(emit.clone())) as *mut c_void;
        IOHIDManagerRegisterDeviceMatchingCallback(manager, on_attached, ctx);
        IOHIDManagerRegisterDeviceRemovalCallback(manager, on_detached, ctx);
        IOHIDManagerRegisterInputValueCallback(manager, on_value, ctx);

        let run_loop = CFRunLoop::get_current();
        let mode = kCFRunLoopDefaultMode;
        IOHIDManagerScheduleWithRunLoop(
            manager,
            run_loop.as_concrete_TypeRef() as *const c_void,
            mode as *const c_void,
        );

        let opened = IOHIDManagerOpen(manager, 0) as u32;
        if opened != 0 {
            emit(HidMessage::Reading(if opened == NOT_PERMITTED {
                Reading::PermissionNeeded
            } else {
                Reading::Unavailable {
                    message: format!(
                        "The system refused access to the headset commands (code {opened:#x})"
                    ),
                }
            }));
            IOHIDManagerUnscheduleFromRunLoop(
                manager,
                run_loop.as_concrete_TypeRef() as *const c_void,
                mode as *const c_void,
            );
            CFRelease(manager as CFTypeRef);
            drop(Box::from_raw(ctx as *mut Emit));
            let _ = started.send(None);
            return;
        }
        emit(HidMessage::Reading(Reading::Listening));
        let _ = started.send(Some(CFRunLoopHandle(run_loop.clone())));

        CFRunLoop::run_current();

        IOHIDManagerUnscheduleFromRunLoop(
            manager,
            run_loop.as_concrete_TypeRef() as *const c_void,
            mode as *const c_void,
        );
        IOHIDManagerClose(manager, 0);
        CFRelease(manager as CFTypeRef);
        drop(Box::from_raw(ctx as *mut Emit));
    }
}

unsafe fn emit_of<'a>(ctx: *mut c_void) -> &'a Emit {
    // SAFETY: `ctx` is the box leaked in `run`, alive until the run loop has stopped.
    unsafe { &*(ctx as *const Emit) }
}

unsafe fn prop_string(device: Device, key: &str) -> Option<String> {
    let k = CFString::new(key);
    // SAFETY: "Get" rule: the value belongs to the device; it is checked to be a string before being read.
    unsafe {
        let v = IOHIDDeviceGetProperty(device, k.as_concrete_TypeRef() as *const c_void);
        (!v.is_null() && CFGetTypeID(v) == CFString::type_id())
            .then(|| CFString::wrap_under_get_rule(v as _).to_string())
    }
}

unsafe fn prop_int(device: Device, key: &str) -> Option<i64> {
    let k = CFString::new(key);
    // SAFETY: as above, for a number.
    unsafe {
        let v = IOHIDDeviceGetProperty(device, k.as_concrete_TypeRef() as *const c_void);
        (!v.is_null() && CFGetTypeID(v) == CFNumber::type_id())
            .then(|| CFNumber::wrap_under_get_rule(v as _).to_i64())
            .flatten()
    }
}

/// Vendor, product and location: stable while the headset stays plugged in, different for two identical ones.
unsafe fn id_of(device: Device) -> String {
    // SAFETY: plain property reads on a live device.
    unsafe {
        format!(
            "{:04x}:{:04x}:{:x}",
            prop_int(device, "VendorID").unwrap_or(0),
            prop_int(device, "ProductID").unwrap_or(0),
            prop_int(device, "LocationID").unwrap_or(0)
        )
    }
}

/// The telephony buttons a device declares (not whether they work: only a press proves that).
unsafe fn buttons_of(device: Device) -> Vec<Usage> {
    let mut found = Vec::new();
    // SAFETY: the array is ours ("Copy" rule) and released below; the elements belong to it.
    unsafe {
        let all = IOHIDDeviceCopyMatchingElements(device, std::ptr::null(), 0);
        if all.is_null() {
            return found;
        }
        let array: CFArray<*const c_void> = CFArray::wrap_under_create_rule(all as _);
        for el in array.iter() {
            let e = *el as Element;
            if IOHIDElementGetUsagePage(e) == Usage::TELEPHONY_PAGE as u32
                && IOHIDElementGetType(e) <= LAST_INPUT_TYPE
            {
                let u = Usage::from_hid(Usage::TELEPHONY_PAGE, IOHIDElementGetUsage(e) as u16);
                if !matches!(u, Usage::Other { .. }) && !found.contains(&u) {
                    found.push(u);
                }
            }
        }
    }
    found
}

extern "C" fn on_attached(ctx: *mut c_void, _: IoReturn, _: *mut c_void, device: Device) {
    // SAFETY: called by IOKit with a live device, on the run loop thread.
    unsafe {
        emit_of(ctx)(HidMessage::Attached(HidDevice {
            id: id_of(device),
            product: prop_string(device, "Product").unwrap_or_else(|| "HID device".into()),
            manufacturer: prop_string(device, "Manufacturer").unwrap_or_default(),
            transport: prop_string(device, "Transport").unwrap_or_default(),
            buttons: buttons_of(device),
        }));
    }
}

extern "C" fn on_detached(ctx: *mut c_void, _: IoReturn, _: *mut c_void, device: Device) {
    // SAFETY: as above.
    unsafe { emit_of(ctx)(HidMessage::Detached(id_of(device))) }
}

extern "C" fn on_value(ctx: *mut c_void, _: IoReturn, _: *mut c_void, value: Value) {
    // SAFETY: called by IOKit with a live value, on the run loop thread.
    unsafe {
        let element = IOHIDValueGetElement(value);
        if IOHIDElementGetUsagePage(element) != Usage::TELEPHONY_PAGE as u32 {
            return;
        }
        let usage = Usage::from_hid(Usage::TELEPHONY_PAGE, IOHIDElementGetUsage(element) as u16);
        let device = IOHIDElementGetDevice(element);
        emit_of(ctx)(HidMessage::Input(HidInput {
            device: id_of(device),
            product: prop_string(device, "Product").unwrap_or_default(),
            usage,
            value: IOHIDValueGetIntegerValue(value) as i32,
            at: Instant::now(),
        }));
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    /// Starts and stops the real HID reading on this machine. It finds whatever telephony devices are plugged in
    /// (none is required) and must come up and go down cleanly. It proves nothing about any headset.
    #[test]
    fn the_real_reading_starts_and_stops_cleanly() {
        let seen: Arc<Mutex<Vec<HidMessage>>> = Arc::default();
        let sink = seen.clone();
        let monitor = HidMonitor::start(Arc::new(move |m| sink.lock().unwrap().push(m)));
        std::thread::sleep(std::time::Duration::from_millis(400));
        drop(monitor);
        let seen = seen.lock().unwrap();
        println!("hid messages: {seen:?}");
        assert!(
            seen.iter().any(|m| matches!(m, HidMessage::Reading(_))),
            "the state of the reading is always reported: {seen:?}"
        );
        for m in seen.iter() {
            if let HidMessage::Attached(d) = m {
                assert!(!d.id.is_empty());
            }
        }
    }
}
