//! Running a remote-control request that comes from the desktop (a keyboard shortcut, the tray menu) and telling
//! the user when it needs them. A command line request gets its answer on the socket instead.

use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use super::AppState;
use crate::{
    control::command::{Command, Outcome, Status},
    shortcuts::ShortcutAction,
};

/// Runs a command in the background. Only what the user must know is shown: a request that finds nothing to do
/// (answer without a call, hang up with no call) stays silent on purpose.
pub fn run(app: &AppHandle, cmd: Command) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let controller = state.controller.clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let outcome = controller.execute(cmd).await;
        tell_user(&app, &outcome);
    });
}

pub fn run_shortcut(app: &AppHandle, action: ShortcutAction) {
    run(app, action.command());
}

fn tell_user(app: &AppHandle, outcome: &Outcome) {
    let message = match outcome.status {
        Status::Ambiguous => {
            // Choosing is the user's: show the app, where the calls are, and say why nothing happened.
            super::show_main_window(app);
            Some(outcome.message.clone())
        }
        Status::Failed => Some(outcome.message.clone()),
        _ => None,
    };
    if let Some(body) = message
        && let Err(e) = app
            .notification()
            .builder()
            .title("ZePhone")
            .body(body)
            .show()
    {
        log::warn!("cannot show notification: {e}");
    }
}
