package com.zenoova.zephone

import android.Manifest
import android.content.pm.PackageManager
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * The phone's own address book, read for the directory (`src-tauri/src/directory/system_contacts_android.rs`, which calls
 * these methods). It stays on the phone: nothing is stored here, and only what the directory uses is read — names,
 * company, department, job title, telephone numbers, e-mail and SIP addresses. Photos, notes, birthdays and postal
 * addresses never are.
 */
class ContactsAccess(private val activity: MainActivity) {
  private val prefs get() = activity.getSharedPreferences("contacts", android.content.Context.MODE_PRIVATE)

  /** 0 = the user was never asked, 1 = refused, 2 = allowed. Android does not say "never asked": the question is counted here. */
  fun access(): Int {
    val granted = ContextCompat.checkSelfPermission(activity, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED
    return when {
      granted -> 2
      prefs.getBoolean("asked", false) -> 1
      else -> 0
    }
  }

  /** Shows the system's question. The answer is read back with [access]. */
  fun request() = activity.runOnUiThread {
    activity.requestPermissions(arrayOf(Manifest.permission.READ_CONTACTS)) {
      prefs.edit().putBoolean("asked", true).apply()
    }
  }

  /** Every contact, one per person (the phone already merges the same person of several accounts), as a JSON array. */
  fun readJson(): String {
    if (access() != 2) return "[]"
    val people = LinkedHashMap<Long, JSONObject>()
    val projection = arrayOf(
      ContactsContract.Data.CONTACT_ID,
      ContactsContract.Data.MIMETYPE,
      ContactsContract.Data.DATA1,
      ContactsContract.Data.DATA2,
      ContactsContract.Data.DATA3,
      ContactsContract.Data.DATA4,
      ContactsContract.Data.DATA5,
    )
    val kinds = arrayOf(
      ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE,
      ContactsContract.CommonDataKinds.Nickname.CONTENT_ITEM_TYPE,
      ContactsContract.CommonDataKinds.Organization.CONTENT_ITEM_TYPE,
      ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE,
      ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE,
      ContactsContract.CommonDataKinds.SipAddress.CONTENT_ITEM_TYPE,
    )
    val selection = kinds.joinToString(" OR ") { "${ContactsContract.Data.MIMETYPE} = ?" }
    activity.contentResolver.query(ContactsContract.Data.CONTENT_URI, projection, selection, kinds, null)?.use { cursor ->
      while (cursor.moveToNext()) {
        val id = cursor.getLong(0)
        val person = people.getOrPut(id) {
          JSONObject().put("id", id.toString()).put("phones", JSONArray()).put("emails", JSONArray()).put("sip", JSONArray())
        }
        val d1 = cursor.getString(2).orEmpty()
        val d2 = cursor.getString(3).orEmpty()
        val d3 = cursor.getString(4).orEmpty()
        when (cursor.getString(1)) {
          kinds[0] -> person.put("given", d2).put("family", d3)
          kinds[1] -> person.put("nickname", d1)
          kinds[2] -> person.put("organization", d1).put("title", cursor.getString(5).orEmpty()).put("department", cursor.getString(6).orEmpty())
          kinds[3] -> if (d1.isNotBlank()) person.getJSONArray("phones").put(JSONObject().put("label", phoneLabel(d2.toIntOrNull(), d3)).put("number", d1))
          kinds[4] -> if (d1.isNotBlank()) person.getJSONArray("emails").put(d1)
          kinds[5] -> if (d1.isNotBlank()) person.getJSONArray("sip").put(d1)
        }
      }
    }
    return JSONArray(people.values.toList()).toString()
  }

  /** The label a number has, in words the directory understands (what the user typed for a custom one). */
  private fun phoneLabel(type: Int?, custom: String): String = when (type) {
    ContactsContract.CommonDataKinds.Phone.TYPE_HOME -> "home"
    ContactsContract.CommonDataKinds.Phone.TYPE_MOBILE -> "mobile"
    ContactsContract.CommonDataKinds.Phone.TYPE_WORK, ContactsContract.CommonDataKinds.Phone.TYPE_WORK_MOBILE -> "work"
    ContactsContract.CommonDataKinds.Phone.TYPE_FAX_WORK, ContactsContract.CommonDataKinds.Phone.TYPE_FAX_HOME -> "fax"
    ContactsContract.CommonDataKinds.Phone.TYPE_PAGER, ContactsContract.CommonDataKinds.Phone.TYPE_WORK_PAGER -> "pager"
    ContactsContract.CommonDataKinds.Phone.TYPE_CUSTOM -> custom
    else -> "other"
  }
}
