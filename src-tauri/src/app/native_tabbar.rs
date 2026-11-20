//! The bottom navigation bar of the iPhone and the iPad: the system's own tab bar (`UITabBar`).
//!
//! Built with the iOS 26 SDK it is drawn in "Liquid Glass"; on iOS 15 to 25 it is the classic bar. Nothing here chooses
//! between the two: it is the same UIKit class. On the other systems the commands do nothing (the page draws its own
//! dock there). The page describes the tabs ([`native_tabbar_install`]), is told when one is tapped (the
//! `native-tab-selected` event, whose payload is the tab's id), and keeps the selection, the badge and the visibility in
//! step ([`native_tabbar_select`], [`native_tabbar_badge`], [`native_tabbar_visible`]).

use serde::Deserialize;
use tauri::AppHandle;

use crate::error::AppResult;

/// Event emitted to the page when the user taps a tab.
pub const TAB_SELECTED_EVENT: &str = "native-tab-selected";

/// One tab, as the page describes it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTab {
    pub id: String,
    pub title: String,
    /// Name of an SF Symbol.
    pub symbol: String,
}

#[tauri::command]
pub fn native_tabbar_install(app: AppHandle, tabs: Vec<NativeTab>) -> AppResult<()> {
    imp::install(&app, tabs);
    Ok(())
}

#[tauri::command]
pub fn native_tabbar_select(app: AppHandle, id: String) -> AppResult<()> {
    imp::select(&app, id);
    Ok(())
}

#[tauri::command]
pub fn native_tabbar_badge(app: AppHandle, id: String, count: u32) -> AppResult<()> {
    imp::badge(&app, id, count);
    Ok(())
}

#[tauri::command]
pub fn native_tabbar_visible(app: AppHandle, visible: bool) -> AppResult<()> {
    imp::visible(&app, visible);
    Ok(())
}

#[cfg(target_os = "ios")]
use super::native_tabbar_ios as imp;

#[cfg(not(target_os = "ios"))]
mod imp {
    use super::NativeTab;
    use tauri::AppHandle;

    pub fn install(_: &AppHandle, _: Vec<NativeTab>) {}
    pub fn select(_: &AppHandle, _: String) {}
    pub fn badge(_: &AppHandle, _: String, _: u32) {}
    pub fn visible(_: &AppHandle, _: bool) {}
}
