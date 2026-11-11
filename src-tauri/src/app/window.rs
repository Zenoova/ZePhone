//! Window appearance: frosted-glass background (macOS vibrancy) and light/dark theme.

use tauri::{AppHandle, Manager};

use super::MAIN_WINDOW;
use crate::sip::types::{GeneralSettings, Theme};

/// Applies the theme and the translucency preference to the main window.
///
/// * The window theme follows the app's own light/dark choice, so the glass material under the
///   page matches the interface (otherwise a dark UI could sit on a light material).
/// * Translucency uses a native `NSVisualEffectView` (the sidebar material, kept active when the
///   window is not focused). The page draws semi-transparent surfaces on top of it.
pub fn apply_appearance(app: &AppHandle, general: &GeneralSettings) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let theme = match general.theme {
        Theme::System => None,
        Theme::Light => Some(tauri::Theme::Light),
        Theme::Dark => Some(tauri::Theme::Dark),
    };
    if let Err(e) = window.set_theme(theme) {
        log::warn!("cannot set the window theme: {e}");
    }

    #[cfg(target_os = "macos")]
    {
        use tauri::window::{Effect, EffectState, EffectsBuilder};
        let effects = general.translucent.then(|| {
            EffectsBuilder::new()
                .effect(Effect::Sidebar)
                .state(EffectState::Active)
                .build()
        });
        if let Err(e) = window.set_effects(effects) {
            log::warn!("cannot set the window effects: {e}");
        }
    }
}
