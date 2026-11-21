package com.zenoova.zephone

import android.view.Gravity
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.FrameLayout
import com.google.android.material.bottomnavigation.BottomNavigationView
import com.google.android.material.navigation.NavigationBarView
import org.json.JSONArray

/**
 * The navigation of the application on Android: Material 3's own navigation bar (`BottomNavigationView`) under the page,
 * instead of the page's dock. The page describes the tabs, follows the taps and keeps the selection, the missed-call
 * badge and the visibility in step (`src/layouts/NativeTabBar.tsx`); this object is what it talks to, on the page as
 * `window.ZephoneNative`. Nothing else of the application is reachable from the page through it.
 */
class NativeTabs(private val activity: MainActivity, private val webView: WebView) {
  private var bar: BottomNavigationView? = null
  private var ids: List<String> = emptyList()

  /** Drawable of each section, by id (`res/drawable/ic_tab_<id>.xml`). */
  private fun icon(id: String): Int = when (id) {
    "dialer" -> R.drawable.ic_tab_dialer
    "contacts" -> R.drawable.ic_tab_contacts
    "history" -> R.drawable.ic_tab_history
    "recordings" -> R.drawable.ic_tab_recordings
    else -> R.drawable.ic_tab_settings
  }

  @JavascriptInterface
  fun install(tabsJson: String) = activity.runOnUiThread {
    if (bar != null) return@runOnUiThread
    val tabs = JSONArray(tabsJson)
    val view = BottomNavigationView(activity)
    val listed = mutableListOf<String>()
    for (i in 0 until tabs.length()) {
      val tab = tabs.getJSONObject(i)
      val id = tab.getString("id")
      listed += id
      view.menu.add(0, i, i, tab.getString("title")).setIcon(icon(id))
    }
    ids = listed
    view.labelVisibilityMode = NavigationBarView.LABEL_VISIBILITY_LABELED
    view.setOnItemSelectedListener { item ->
      val id = ids.getOrNull(item.itemId) ?: return@setOnItemSelectedListener false
      webView.evaluateJavascript("window.__zephoneNativeTab && window.__zephoneNativeTab(${quote(id)})", null)
      true
    }
    val content = activity.findViewById<FrameLayout>(android.R.id.content)
    content.addView(
      view,
      FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM),
    )
    bar = view
    // The page ends where the bar begins: the bar is opaque, so there is nothing for the page to show under it.
    view.addOnLayoutChangeListener { _, _, top, _, bottom, _, _, _, _ -> resizePage(if (view.visibility == View.VISIBLE) bottom - top else 0) }
  }

  @JavascriptInterface
  fun select(id: String) = activity.runOnUiThread {
    val index = ids.indexOf(id)
    // `isChecked` does not fire the listener: the page already knows.
    if (index >= 0) bar?.menu?.getItem(index)?.isChecked = true
  }

  @JavascriptInterface
  fun badge(id: String, count: Int) = activity.runOnUiThread {
    val index = ids.indexOf(id)
    val view = bar ?: return@runOnUiThread
    if (index < 0) return@runOnUiThread
    if (count > 0) {
      val badge = view.getOrCreateBadge(index)
      badge.number = count
      badge.maxCharacterCount = 3
    } else {
      view.removeBadge(index)
    }
  }

  @JavascriptInterface
  fun visible(visible: Boolean) = activity.runOnUiThread {
    val view = bar ?: return@runOnUiThread
    view.visibility = if (visible) View.VISIBLE else View.GONE
    resizePage(if (visible) view.height else 0)
  }

  private fun resizePage(bottom: Int) {
    val params = webView.layoutParams as? FrameLayout.LayoutParams ?: return
    if (params.bottomMargin == bottom) return
    params.bottomMargin = bottom
    webView.layoutParams = params
  }

  private fun quote(text: String) = "'" + text.replace("\\", "\\\\").replace("'", "\\'") + "'"
}
