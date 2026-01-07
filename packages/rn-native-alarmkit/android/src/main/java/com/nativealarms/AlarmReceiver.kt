package com.nativealarms

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * BroadcastReceiver that handles alarm trigger events
 */
class AlarmReceiver : BroadcastReceiver() {

    companion object {
        // Versioned channel id so sound/behavior changes apply (channels are immutable once created)
        const val CHANNEL_ID = "native_alarms_channel_v2"
        const val CHANNEL_NAME = "Alarms"
        const val ACTION_DISMISS = "com.nativealarms.ACTION_DISMISS"
        const val ACTION_SNOOZE = "com.nativealarms.ACTION_SNOOZE"
        const val ACTION_OPEN = "com.nativealarms.ACTION_OPEN"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val alarmId = intent.getStringExtra("alarmId") ?: return
        val title = intent.getStringExtra("title") ?: "Alarm"
        val body = intent.getStringExtra("body")
        val sound = intent.getStringExtra("sound")
        val scheduleType = intent.getStringExtra("scheduleType")
        val isInexact = intent.getBooleanExtra("isInexact", false)
        val url = intent.getStringExtra("url")

        // Create notification channel
        createNotificationChannel(context)

        // Show notification
        showAlarmNotification(context, alarmId, title, body, sound, url)

        // Best-effort looping alarm sound (stops on open/dismiss/snooze)
        AlarmSoundPlayer.start(context, alarmId, sound)

        // Send event to React Native
        sendAlarmFiredEvent(context, alarmId)

        // Reschedule if recurring or interval
        if (scheduleType == "recurring" || scheduleType == "interval") {
            rescheduleAlarm(context, alarmId, isInexact)
        }
    }

    private fun createNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val importance = NotificationManager.IMPORTANCE_HIGH
            val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, importance).apply {
                description = "Alarm notifications"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 500, 250, 500)

                // Make the channel itself silent; we play a looping alarm sound via AlarmSoundPlayer.
                // (Channel sounds are not loopable and are immutable once created.)
                setSound(null, null)
            }

            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun showAlarmNotification(
        context: Context,
        alarmId: String,
        title: String,
        body: String?,
        sound: String?,
        url: String?
    ) {
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // Open action (tap) -> stop alarm sound, dismiss notification, and open deep link (if available)
        val openIntent = Intent(context, AlarmActionReceiver::class.java).apply {
            action = ACTION_OPEN
            putExtra("alarmId", alarmId)
            if (url != null) putExtra("url", url)
        }
        val openPendingIntent = PendingIntent.getBroadcast(
            context,
            (alarmId + "_open").hashCode(),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Dismiss action
        val dismissIntent = Intent(context, AlarmActionReceiver::class.java).apply {
            action = ACTION_DISMISS
            putExtra("alarmId", alarmId)
        }
        val dismissPendingIntent = PendingIntent.getBroadcast(
            context,
            (alarmId + "_dismiss").hashCode(),
            dismissIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Snooze action
        val snoozeIntent = Intent(context, AlarmActionReceiver::class.java).apply {
            action = ACTION_SNOOZE
            putExtra("alarmId", alarmId)
        }
        val snoozePendingIntent = PendingIntent.getBroadcast(
            context,
            (alarmId + "_snooze").hashCode(),
            snoozeIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Delete intent (swipe away) -> stop sound
        val deleteIntent = Intent(context, AlarmActionReceiver::class.java).apply {
            action = ACTION_DISMISS
            putExtra("alarmId", alarmId)
        }
        val deletePendingIntent = PendingIntent.getBroadcast(
            context,
            (alarmId + "_delete").hashCode(),
            deleteIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Build notification
        val notificationBuilder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(title)
            .setContentIntent(openPendingIntent)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(false)
            .setOngoing(true)
            .setDeleteIntent(deletePendingIntent)
            .setVibrate(longArrayOf(0, 500, 250, 500))
            .addAction(android.R.drawable.ic_delete, "Dismiss", dismissPendingIntent)
            .addAction(android.R.drawable.ic_menu_recent_history, "Snooze", snoozePendingIntent)

        if (body != null) {
            notificationBuilder.setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        }

        // Sound is handled by AlarmSoundPlayer (looping)

        // Show notification
        notificationManager.notify(alarmId.hashCode(), notificationBuilder.build())
    }

    private fun sendAlarmFiredEvent(context: Context, alarmId: String) {
        try {
            // Get alarm data from storage
            val alarmData = AlarmStorage.getAlarm(context, alarmId)
                ?: AlarmStorage.getAlarm(context, "fallback_$alarmId")

            if (alarmData != null) {
                val params = Arguments.createMap().apply {
                    putMap("alarm", Arguments.createMap().apply {
                        putString("id", alarmId)
                        putMap("schedule", alarmData.schedule)
                        putMap("config", alarmData.config)
                        putString("nextFireDate", alarmData.nextFireDate.toString())
                        putBoolean("isActive", true)
                    })
                    putString("firedAt", System.currentTimeMillis().toString())
                }

                // Send event through React Native module
                val reactContext = getReactContext(context)
                reactContext?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    ?.emit("RNNativeAlarms_AlarmFired", params)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun rescheduleAlarm(context: Context, alarmId: String, isInexact: Boolean) {
        try {
            // Get alarm data
            val storageId = if (isInexact) "fallback_$alarmId" else alarmId
            val alarmData = AlarmStorage.getAlarm(context, storageId) ?: return

            // Reschedule using appropriate manager
            if (isInexact) {
                val fallback = NotificationFallback(context)
                fallback.scheduleAlarm(alarmData.schedule, alarmData.config)
            } else {
                val exactManager = ExactAlarmManager(context)
                exactManager.scheduleAlarm(alarmData.schedule, alarmData.config)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun getReactContext(context: Context): com.facebook.react.bridge.ReactApplicationContext? {
        return try {
            context.applicationContext as? com.facebook.react.bridge.ReactApplicationContext
        } catch (e: Exception) {
            null
        }
    }
}

/**
 * Handles alarm action buttons (dismiss, snooze)
 */
class AlarmActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val alarmId = intent.getStringExtra("alarmId") ?: return
        val action = intent.action

        when (action) {
            AlarmReceiver.ACTION_DISMISS -> {
                AlarmSoundPlayer.stop(alarmId)
                // Just dismiss the notification
                val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                notificationManager.cancel(alarmId.hashCode())
            }

            AlarmReceiver.ACTION_SNOOZE -> {
                AlarmSoundPlayer.stop(alarmId)
                // Dismiss notification
                val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                notificationManager.cancel(alarmId.hashCode())

                // Snooze for 10 minutes
                try {
                    val alarmData = AlarmStorage.getAlarm(context, alarmId)
                        ?: AlarmStorage.getAlarm(context, "fallback_$alarmId")

                    if (alarmData != null) {
                        val isInexact = alarmData.id.startsWith("fallback_")

                        if (isInexact) {
                            val fallback = NotificationFallback(context)
                            fallback.snoozeAlarm(alarmId, 10)
                        } else {
                            val exactManager = ExactAlarmManager(context)
                            exactManager.snoozeAlarm(alarmId, 10)
                        }
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }

            AlarmReceiver.ACTION_OPEN -> {
                AlarmSoundPlayer.stop(alarmId)
                val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                notificationManager.cancel(alarmId.hashCode())

                val url = intent.getStringExtra("url")
                val packageName = context.packageName
                val mainLaunchIntent = context.packageManager.getLaunchIntentForPackage(packageName)
                val mainComponent = mainLaunchIntent?.component

                // Use the app's main activity component to ensure it reliably comes to foreground from background.
                // (Using setPackage on ACTION_VIEW can fail to resolve in some setups.)
                val launchIntent = if (url != null && mainComponent != null) {
                    Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                        component = mainComponent
                        addCategory(Intent.CATEGORY_DEFAULT)
                        addCategory(Intent.CATEGORY_BROWSABLE)
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                        putExtra("alarmId", alarmId)
                    }
                } else {
                    mainLaunchIntent?.apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                        putExtra("alarmId", alarmId)
                        if (url != null) {
                            putExtra("url", url)
                        }
                    }
                }
                if (launchIntent != null) {
                    context.startActivity(launchIntent)
                }
            }
        }
    }
}

/**
 * Best-effort looping alarm sound playback for Android.
 *
 * Notes:
 * - NotificationChannel sounds do not loop and are immutable once created.
 * - This uses RingtoneManager and attempts to loop on API 28+.
 * - Playback stops on open/dismiss/snooze actions.
 */
private object AlarmSoundPlayer {
    private val active = HashMap<String, android.media.Ringtone>()

    fun start(context: Context, alarmId: String, sound: String?) {
        try {
            // Stop any existing sound for this alarm
            stop(alarmId)

            val soundNameRaw = sound?.substringBeforeLast('.') // strip .wav/.mp3 if present
            val soundUri: Uri = when {
                soundNameRaw == null || soundNameRaw == "none" -> RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                soundNameRaw == "default" -> RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                else -> {
                    val soundResId = context.resources.getIdentifier(soundNameRaw, "raw", context.packageName)
                    if (soundResId != 0) {
                        Uri.parse("android.resource://${context.packageName}/$soundResId")
                    } else {
                        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                    }
                }
            }

            val ringtone = RingtoneManager.getRingtone(context, soundUri) ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                ringtone.isLooping = true
            }
            ringtone.audioAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            ringtone.play()
            active[alarmId] = ringtone
        } catch (_: Exception) {
            // best-effort: do not crash the receiver
        }
    }

    fun stop(alarmId: String) {
        try {
            val ringtone = active.remove(alarmId)
            ringtone?.stop()
        } catch (_: Exception) {
        }
    }
}
