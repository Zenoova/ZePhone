//! Local call recording: the audio comes from the engine as two raw files (one per side), which are mixed into
//! one WAV per call, kept in the application's data folder and listed in the database.

pub mod wav;

use serde::Serialize;

use crate::sip::types::CallDirection;

/// A finished recording, as listed to the user.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    pub id: String,
    /// The engine's id of the call (to link the history entry written when it ends).
    #[serde(skip_serializing)]
    pub call_id: Option<String>,
    pub history_id: Option<String>,
    /// Name of the audio file inside the recordings folder.
    pub file_name: String,
    /// Absolute path of the audio file, for the player.
    pub path: String,
    pub started_at: String,
    pub duration_secs: u64,
    pub size_bytes: u64,
    pub remote_number: String,
    pub remote_name: Option<String>,
    pub account_label: Option<String>,
    pub direction: CallDirection,
    /// Waveform: loudness across the call, 0-255.
    pub peaks: Vec<u8>,
}
