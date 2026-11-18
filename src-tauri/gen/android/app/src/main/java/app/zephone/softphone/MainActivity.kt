package app.zephone.softphone

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.os.Build
import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File

/**
 * The Android shell of ZePhone. The application itself is the Rust library; this class only does what the Rust
 * side cannot reach without Java:
 *  - asks for the permissions a call needs (microphone, notifications),
 *  - keeps the process alive with a foreground service ([SipService]) so the SIP registration survives,
 *  - tells the engine which DNS servers the network uses (Android has no /etc/resolv.conf),
 *  - keeps the web page out from under the system bars.
 */
class MainActivity : TauriActivity() {
  private val connectivity by lazy { getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager }

  private val permissionRequest =
    registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { startSipService() }

  private val networkCallback = object : ConnectivityManager.NetworkCallback() {
    override fun onLinkPropertiesChanged(network: Network, linkProperties: LinkProperties) {
      if (network == connectivity.activeNetwork) writeDnsServers(linkProperties)
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    // Before the Rust side starts the engine (it starts with super.onCreate): the engine reads this file.
    writeDnsServers(connectivity.getLinkProperties(connectivity.activeNetwork))
    super.onCreate(savedInstanceState)

    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
      )
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }

    runCatching { connectivity.registerDefaultNetworkCallback(networkCallback) }

    val missing = requiredPermissions().filter {
      ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
    }
    if (missing.isEmpty()) startSipService() else permissionRequest.launch(missing.toTypedArray())
  }

  override fun onDestroy() {
    runCatching { connectivity.unregisterNetworkCallback(networkCallback) }
    super.onDestroy()
  }

  private fun requiredPermissions(): List<String> {
    val list = mutableListOf(Manifest.permission.RECORD_AUDIO)
    if (Build.VERSION.SDK_INT >= 33) list += Manifest.permission.POST_NOTIFICATIONS
    return list
  }

  /** The service needs the microphone permission to be allowed to declare the microphone type. */
  private fun startSipService() {
    val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED
    if (granted) runCatching { SipService.start(this) }
  }

  private fun writeDnsServers(properties: LinkProperties?) {
    val servers = properties?.dnsServers?.mapNotNull { it.hostAddress?.substringBefore('%') } ?: return
    runCatching { File(dataDir, "dns-servers.txt").writeText(servers.joinToString("\n")) }
  }
}
