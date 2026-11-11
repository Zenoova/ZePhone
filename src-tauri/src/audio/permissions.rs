//! Microphone permission (macOS TCC). The prompt text comes from
//! `NSMicrophoneUsageDescription` in `Info.plist`; the app bundle also carries the
//! `com.apple.security.device.audio-input` entitlement for hardened-runtime builds.

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MicPermission {
    NotDetermined,
    Denied,
    Restricted,
    Authorized,
}

#[cfg(target_os = "macos")]
mod imp {
    use super::MicPermission;
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeAudio};

    pub fn status() -> MicPermission {
        // SAFETY: AVMediaTypeAudio is a valid constant NSString on every supported macOS.
        let Some(media) = (unsafe { AVMediaTypeAudio }) else {
            return MicPermission::Authorized;
        };
        let st = unsafe { AVCaptureDevice::authorizationStatusForMediaType(media) };
        match st {
            AVAuthorizationStatus::Authorized => MicPermission::Authorized,
            AVAuthorizationStatus::Denied => MicPermission::Denied,
            AVAuthorizationStatus::Restricted => MicPermission::Restricted,
            _ => MicPermission::NotDetermined,
        }
    }

    /// Shows the system prompt if the status is "not determined"; resolves with the final status.
    pub async fn request() -> MicPermission {
        if status() != MicPermission::NotDetermined {
            return status();
        }
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        {
            // Objective-C objects are not `Send`: keep them out of the await below. The OS
            // retains its own copy of the completion block.
            let tx = std::sync::Mutex::new(Some(tx));
            let block = RcBlock::new(move |_granted: Bool| {
                if let Some(tx) = tx.lock().unwrap().take() {
                    let _ = tx.send(());
                }
            });
            if let Some(media) = unsafe { AVMediaTypeAudio } {
                unsafe {
                    AVCaptureDevice::requestAccessForMediaType_completionHandler(media, &block)
                };
            }
        }
        let _ = tokio::time::timeout(std::time::Duration::from_secs(120), rx).await;
        status()
    }

    pub fn open_settings() -> std::io::Result<()> {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
            .spawn()
            .map(|_| ())
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::MicPermission;

    pub fn status() -> MicPermission {
        MicPermission::Authorized
    }
    pub async fn request() -> MicPermission {
        MicPermission::Authorized
    }
    pub fn open_settings() -> std::io::Result<()> {
        Ok(())
    }
}

pub use imp::{open_settings, request, status};
