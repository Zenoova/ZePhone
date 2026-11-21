package com.zenoova.zephone

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * Keeps ZePhone running while it is not on screen. Without a foreground service Android freezes the process a
 * few minutes after the screen goes off: the SIP registration lapses, incoming calls are missed, and a call in
 * progress loses its microphone. The notification is the price of that; it also opens the application.
 */
class SipService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL, getString(R.string.sip_service_channel), NotificationManager.IMPORTANCE_LOW)
      )
    }
    val open = PendingIntent.getActivity(
      this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
    val notification: Notification = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(getString(R.string.app_name))
      .setContentText(getString(R.string.sip_service_text))
      .setContentIntent(open)
      .setOngoing(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .build()
    when {
      Build.VERSION.SDK_INT >= 34 -> startForeground(
        ID, notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
      )
      Build.VERSION.SDK_INT >= 30 -> startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      else -> startForeground(ID, notification)
    }
    return START_STICKY
  }

  companion object {
    private const val CHANNEL = "sip-service"
    private const val ID = 1

    fun start(context: Context) {
      ContextCompat.startForegroundService(context, Intent(context, SipService::class.java))
    }
  }
}
