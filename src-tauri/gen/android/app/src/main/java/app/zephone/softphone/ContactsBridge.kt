package app.zephone.softphone

/**
 * What the Rust side calls (`src-tauri/src/directory/system_contacts_android.rs`): static methods, because the native
 * code reaches the application through its class loader and has no reference to the activity. They forward to
 * [ContactsAccess] and to the activity while there is one.
 */
object ContactsBridge {
  @JvmStatic fun access(): Int = MainActivity.current?.contactsAccess() ?: 0
  @JvmStatic fun request() { MainActivity.current?.requestContactsAccess() }
  @JvmStatic fun readJson(): String = MainActivity.current?.readContactsJson() ?: "[]"
  @JvmStatic fun openSettings() { MainActivity.current?.openAppSettings() }
}
