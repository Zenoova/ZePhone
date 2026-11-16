//! Audio device discovery and OS microphone permission.
//!
//! The actual audio I/O is done by the SIP engine (Baresip / CoreAudio on macOS);
//! here we only list devices the user can pick from, using the same CoreAudio
//! device names Baresip matches against.

pub mod devices;
pub mod diagnostics;
pub mod permissions;
pub mod router;
pub mod routing;

use cpal::traits::{DeviceTrait, HostTrait};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub name: String,
    pub is_default: bool,
    /// Baresip's config syntax cannot express every name (commas, `#`, very long names).
    pub selectable: bool,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevices {
    pub inputs: Vec<AudioDevice>,
    pub outputs: Vec<AudioDevice>,
}

pub fn is_selectable(name: &str) -> bool {
    !name.is_empty()
        && name.len() < 64
        && !name.contains([',', '#'])
        && !name.chars().any(char::is_control)
}

fn collect(
    devices: impl Iterator<Item = cpal::Device>,
    default_name: Option<String>,
) -> Vec<AudioDevice> {
    let mut out: Vec<AudioDevice> = vec![];
    for d in devices {
        let Ok(desc) = d.description() else { continue };
        let name = desc.name().to_owned();
        if out.iter().any(|x| x.name == name) {
            continue;
        }
        out.push(AudioDevice {
            is_default: default_name.as_deref() == Some(name.as_str()),
            selectable: is_selectable(&name),
            name,
        });
    }
    out.sort_by(|a, b| {
        b.is_default
            .cmp(&a.is_default)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    out
}

/// Names of the current system default (input, output) devices.
pub fn default_names() -> (Option<String>, Option<String>) {
    let host = cpal::default_host();
    let name_of = |d: Option<cpal::Device>| {
        d.and_then(|d| d.description().ok())
            .map(|d| d.name().to_owned())
    };
    (
        name_of(host.default_input_device()),
        name_of(host.default_output_device()),
    )
}

pub fn list_devices() -> AudioDevices {
    let host = cpal::default_host();
    let name_of = |d: Option<cpal::Device>| {
        d.and_then(|d| d.description().ok())
            .map(|d| d.name().to_owned())
    };
    let default_in = name_of(host.default_input_device());
    let default_out = name_of(host.default_output_device());
    AudioDevices {
        inputs: host
            .input_devices()
            .map(|it| collect(it, default_in))
            .unwrap_or_default(),
        outputs: host
            .output_devices()
            .map(|it| collect(it, default_out))
            .unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selectable_names() {
        assert!(is_selectable("MacBook Pro Microphone"));
        assert!(!is_selectable("Weird, Name"));
        assert!(!is_selectable("Hash # name"));
        assert!(!is_selectable(""));
        assert!(!is_selectable(&"x".repeat(80)));
    }

    #[test]
    fn listing_does_not_panic_without_a_sound_card() {
        // CI machines may have no audio hardware: the call must still succeed.
        let d = list_devices();
        for dev in d.inputs.iter().chain(d.outputs.iter()) {
            assert!(!dev.name.is_empty());
        }
    }
}
