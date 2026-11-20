//! `UITabBar` for [`super::native_tabbar`] (iOS only). Every call into UIKit runs on the main thread, inside
//! `with_webview`, and the state lives in a thread-local of that thread.

use std::cell::RefCell;

use objc2::{
    AllocAnyThread, define_class, msg_send,
    rc::{Allocated, Retained},
    runtime::{AnyClass, AnyObject, NSObject},
};
use objc2_foundation::{NSArray, NSPoint, NSRect, NSSize, NSString};
use tauri::{AppHandle, Emitter, Manager};

use super::{MAIN_WINDOW, native_tabbar::NativeTab, native_tabbar::TAB_SELECTED_EVENT};

#[derive(Default)]
struct State {
    app: Option<AppHandle>,
    bar: Option<Retained<AnyObject>>,
    /// The bar's items, in the order of the tab ids; kept alive here (a bar holds its delegate weakly).
    items: Vec<Retained<AnyObject>>,
    delegate: Option<Retained<TabBarDelegate>>,
    ids: Vec<String>,
    visible: bool,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State { visible: true, ..State::default() });
}

define_class!(
    // SAFETY: `NSObject` has no requirements for a subclass; the class has no state and no `Drop`.
    #[unsafe(super(NSObject))]
    #[name = "ZePhoneTabBarDelegate"]
    struct TabBarDelegate;

    impl TabBarDelegate {
        // The method of `UITabBarDelegate` (UIKit only looks for the selector).
        #[unsafe(method(tabBar:didSelectItem:))]
        fn tab_bar_did_select_item(&self, _bar: &AnyObject, item: &AnyObject) {
            // SAFETY: `item` is a `UITabBarItem`.
            let tag: isize = unsafe { msg_send![item, tag] };
            STATE.with(|s| {
                let s = s.borrow();
                let (Some(app), Some(id)) = (&s.app, usize::try_from(tag).ok().and_then(|i| s.ids.get(i))) else {
                    return;
                };
                if let Err(e) = app.emit(TAB_SELECTED_EVENT, id) {
                    log::warn!("cannot tell the page which tab was tapped: {e}");
                }
            });
        }
    }
);

/// Runs `f` on the main thread with the webview's `UIView`.
fn with_webview(app: &AppHandle, f: impl FnOnce(&AnyObject) + Send + 'static) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let result = window.with_webview(move |webview| {
        // SAFETY: on the main thread; `inner` is the live `WKWebView` of the window.
        if let Some(webview) = unsafe { webview.inner().cast::<AnyObject>().as_ref() } {
            f(webview);
        }
    });
    if let Err(e) = result {
        log::warn!("cannot reach the webview: {e}");
    }
}

pub fn install(app: &AppHandle, tabs: Vec<NativeTab>) {
    let handle = app.clone();
    with_webview(app, move |webview| {
        if STATE.with(|s| s.borrow().bar.is_some()) {
            return; // already there: the page asked twice (a reload)
        }
        // SAFETY: UIKit calls on the main thread, with objects created here.
        unsafe {
            let parent: Option<Retained<AnyObject>> = msg_send![webview, superview];
            let Some(parent) = parent else {
                return;
            };
            let (Some(bar_class), Some(item_class), Some(image_class), Some(appearance_class)) = (
                AnyClass::get(c"UITabBar"),
                AnyClass::get(c"UITabBarItem"),
                AnyClass::get(c"UIImage"),
                AnyClass::get(c"UITabBarAppearance"),
            ) else {
                return;
            };
            let bar: Retained<AnyObject> = msg_send![bar_class, new];
            let mut items = Vec::new();
            for (tag, tab) in tabs.iter().enumerate() {
                let title = NSString::from_str(&tab.title);
                let symbol = NSString::from_str(&tab.symbol);
                let image: Option<Retained<AnyObject>> =
                    msg_send![image_class, systemImageNamed: &*symbol];
                let blank: Allocated<AnyObject> = msg_send![item_class, alloc];
                let item: Retained<AnyObject> = msg_send![blank, initWithTitle: &*title, image: image.as_deref(), tag: tag as isize];
                items.push(item);
            }
            let array = NSArray::from_retained_slice(&items);
            let _: () = msg_send![&*bar, setItems: &*array, animated: false];
            if let Some(first) = items.first() {
                let _: () = msg_send![&*bar, setSelectedItem: &**first];
            }
            // The page is not a scroll view UIKit knows about, so the bar would stay in its transparent "scrolled to the
            // edge" look: give it the standard one (a Liquid Glass bar on iOS 26, a blurred one before).
            let appearance: Retained<AnyObject> = msg_send![appearance_class, new];
            let _: () = msg_send![&*appearance, configureWithDefaultBackground];
            let _: () = msg_send![&*bar, setStandardAppearance: &*appearance];
            let _: () = msg_send![&*bar, setScrollEdgeAppearance: &*appearance];

            let delegate: Retained<TabBarDelegate> = msg_send![TabBarDelegate::alloc(), init];
            let _: () = msg_send![&*bar, setDelegate: &*delegate];
            // Stays at the bottom whatever the size of the view (rotation, split view).
            let _: () = msg_send![&*bar, setAutoresizingMask: 2usize | 8usize];
            let _: () = msg_send![&*parent, addSubview: &*bar];

            STATE.with(|s| {
                let mut s = s.borrow_mut();
                s.ids = tabs.into_iter().map(|t| t.id).collect();
                s.app = Some(handle);
                s.items = items;
                s.delegate = Some(delegate);
                s.bar = Some(bar);
            });
            layout(webview);
        }
    });
}

pub fn select(app: &AppHandle, id: String) {
    with_webview(app, move |_| {
        STATE.with(|s| {
            let s = s.borrow();
            let (Some(bar), Some(index)) = (&s.bar, s.ids.iter().position(|i| *i == id)) else {
                return;
            };
            // SAFETY: main thread; `items[index]` is one of the bar's items.
            unsafe {
                let _: () = msg_send![&**bar, setSelectedItem: &*s.items[index]];
            }
        });
    });
}

pub fn badge(app: &AppHandle, id: String, count: u32) {
    with_webview(app, move |_| {
        STATE.with(|s| {
            let s = s.borrow();
            let Some(index) = s.ids.iter().position(|i| *i == id) else {
                return;
            };
            let value = (count > 0).then(|| NSString::from_str(&if count > 99 { "99+".into() } else { count.to_string() }));
            // SAFETY: main thread; `setBadgeValue:` takes a string or nil.
            unsafe {
                let _: () = msg_send![&*s.items[index], setBadgeValue: value.as_deref()];
            }
        });
    });
}

pub fn visible(app: &AppHandle, visible: bool) {
    with_webview(app, move |webview| {
        STATE.with(|s| s.borrow_mut().visible = visible);
        // SAFETY: main thread.
        unsafe { layout(webview) };
    });
}

/// Lays out the bar and the webview: the bar at the bottom of the view, the webview above it (or the whole view when the
/// bar is hidden or not installed yet). Also called at every resize (`viewport_ios`).
///
/// # Safety
/// Main thread; `webview` is a live `WKWebView` that has a superview.
pub(super) unsafe fn layout(webview: &AnyObject) {
    // SAFETY: the caller's guarantees; plain `UIView` accessors.
    unsafe {
        let parent: Option<Retained<AnyObject>> = msg_send![webview, superview];
        let Some(parent) = parent else {
            return;
        };
        let bounds: NSRect = msg_send![&*parent, bounds];
        let mut height = bounds.size.height;
        STATE.with(|s| {
            let s = s.borrow();
            let Some(bar) = &s.bar else {
                return;
            };
            let _: () = msg_send![&**bar, setHidden: !s.visible];
            if s.visible {
                let fit: NSSize = msg_send![&**bar, sizeThatFits: NSSize::new(bounds.size.width, 0.0)];
                let frame = NSRect::new(
                    NSPoint::new(0.0, bounds.size.height - fit.height),
                    NSSize::new(bounds.size.width, fit.height),
                );
                let _: () = msg_send![&**bar, setFrame: frame];
                height -= fit.height;
            }
        });
        let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(bounds.size.width, height));
        let _: () = msg_send![webview, setFrame: frame];
    }
}
