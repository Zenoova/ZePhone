//! iOS: the webview fills the screen.
//!
//! The webview is as large as the screen, but WebKit lays the page out in the safe area only (its scroll view
//! adds the safe-area insets by itself) from the top-left corner of the screen: on an iPhone the page ends above
//! the home indicator, with an empty band under it (the two safe-area heights, 96 points on an iPhone 17 Pro),
//! while its safe-area insets (`env(safe-area-inset-*)`) describe a screen it does not cover. The page is written
//! for a webview that covers the screen and keeps out of the safe areas itself, so the automatic insets are
//! turned off, and the webview is kept as large as the view that holds it.

use objc2::{msg_send, runtime::AnyObject};
use objc2_foundation::NSRect;
use tauri::{AppHandle, Manager};

use super::MAIN_WINDOW;

/// `UIScrollViewContentInsetAdjustmentBehavior.never`.
const NEVER: isize = 2;

/// `UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight`.
const FLEXIBLE_WIDTH_AND_HEIGHT: usize = 2 | 16;

/// Makes the main webview as large as its parent view.
pub fn fill_screen(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let result = window.with_webview(|webview| {
        let webview = webview.inner().cast::<AnyObject>();
        // SAFETY: runs on the main thread (`with_webview`); `inner` is the live `WKWebView` of the window, and
        // these are plain `UIView` accessors.
        unsafe {
            let Some(webview) = webview.as_ref() else {
                return;
            };
            let parent: *mut AnyObject = msg_send![webview, superview];
            let Some(parent) = parent.as_ref() else {
                return;
            };
            // WebKit shrinks the page by the safe areas by itself ("automatic" insets of its scroll view), which
            // leaves the same empty band under the page: the page handles the safe areas through CSS.
            let scroll: *mut AnyObject = msg_send![webview, scrollView];
            if let Some(scroll) = scroll.as_ref() {
                let _: () = msg_send![scroll, setContentInsetAdjustmentBehavior: NEVER];
            }
            let bounds: NSRect = msg_send![parent, bounds];
            let _: () = msg_send![webview, setFrame: bounds];
            let _: () = msg_send![webview, setAutoresizingMask: FLEXIBLE_WIDTH_AND_HEIGHT];
        }
    });
    if let Err(e) = result {
        log::warn!("cannot resize the webview to the screen: {e}");
    }
}
