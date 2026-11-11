//! Baresip driven as a managed child process through `ctrl_tcp`.
//!
//! Why a process rather than `libbaresip` FFI for v1: no C toolchain/bindgen
//! step in the build, a crash in the C stack cannot take the UI down, the
//! binary and its modules are bundled as a Tauri sidecar, and the
//! [`SipEngine`](super::SipEngine) trait keeps the door open to an FFI engine.

pub mod client;
pub mod config;
pub mod engine;
pub mod process;

pub use engine::BaresipEngine;
pub use process::BaresipPaths;
