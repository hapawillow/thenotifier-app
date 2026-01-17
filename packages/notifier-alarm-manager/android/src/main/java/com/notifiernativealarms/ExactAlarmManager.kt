package com.notifiernativealarms

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import java.util.Calendar

/**
 * Manages exact alarms using AlarmManager
 */
class ExactAlarmManager(private val context: Context) {

    private val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    /**
     * Schedule an exact alarm
     */
    fun scheduleAlarm(schedule: ReadableMap, config: ReadableMap): WritableMap {
        val alarmId = schedule.getString("id") ?: throw IllegalArgumentException("Alarm ID required")
        val type = schedule.getString("type") ?: "fixed"

        // CRITICAL: Cancel any existing alarm with this ID first to prevent duplicates
        // This handles cases where scheduleAlarm is called multiple times for the same alarm
        try {
            cancelAlarm(alarmId)
        } catch (e: Exception) {
            // Ignore if alarm doesn't exist - that's fine
        }

        // Check if we can schedule exact alarms
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
            throw SecurityException("Cannot schedule exact alarms - permission denied")
        }

        // Calculate trigger time
        val triggerTime = when (type) {
            "recurring" -> calculateRecurringTriggerTime(schedule)
            "interval" -> calculateIntervalTriggerTime(schedule)
            "fixed" -> calculateFixedTriggerTime(schedule)
            else -> throw IllegalArgumentException("Invalid schedule type: $type")
        }

        // Schedule alarm(s)
        when (type) {
            "recurring" -> scheduleRecurringAlarm(alarmId, schedule, config, triggerTime)
            "interval", "fixed" -> scheduleSingleAlarm(alarmId, schedule, config, triggerTime)
        }

        // Save to storage (only once, after scheduling)
        AlarmStorage.saveAlarm(context, alarmId, schedule, config, triggerTime)

        // Build response
        return Arguments.createMap().apply {
            putString("id", alarmId)
            putMap("schedule", schedule)
            putMap("config", config)
            putString("nextFireDate", triggerTime.toString())
            putString("capability", "native_alarms")
            putBoolean("isActive", true)
            putString("platformAlarmId", alarmId)
        }
    }

    /**
     * Cancel alarm by ID
     */
    fun cancelAlarm(alarmId: String) {
        val alarmData = AlarmStorage.getAlarm(context, alarmId)

        if (alarmData != null) {
            val type = alarmData.schedule.getString("type")

            if (type == "recurring") {
                // Cancel all day-specific alarms
                val daysOfWeek = alarmData.schedule.getArray("daysOfWeek")
                if (daysOfWeek != null) {
                    for (i in 0 until daysOfWeek.size()) {
                        val day = daysOfWeek.getInt(i)
                        cancelSingleAlarm("$alarmId-day$day")
                    }
                } else {
                    // Daily alarm
                    cancelSingleAlarm(alarmId)
                }
            } else {
                cancelSingleAlarm(alarmId)
            }
        } else {
            // Try to cancel anyway in case storage is out of sync
            cancelSingleAlarm(alarmId)
        }

        AlarmStorage.deleteAlarm(context, alarmId)
    }

    /**
     * Delete alarm from storage only (without cancelling AlarmManager alarm)
     * Used after alarm has already fired and been cleaned up
     */
    fun deleteAlarmFromStorage(alarmId: String) {
        android.util.Log.d("ExactAlarmManager", "deleteAlarmFromStorage: alarmId=$alarmId")
        AlarmStorage.deleteAlarm(context, alarmId)
        android.util.Log.d("ExactAlarmManager", "deleteAlarmFromStorage: completed for alarmId=$alarmId")
    }

    /**
     * Cancel all alarms
     */
    fun cancelAllAlarms() {
        val alarms = AlarmStorage.getAllAlarms(context)
        alarms.forEach { alarm ->
            cancelAlarm(alarm.id)
        }
    }

    /**
     * Cancel alarms by category
     */
    fun cancelAlarmsByCategory(category: String) {
        val alarms = AlarmStorage.getAlarmsByCategory(context, category)
        alarms.forEach { alarm ->
            cancelAlarm(alarm.id)
        }
    }

    /**
     * Get alarm by ID
     */
    fun getAlarm(alarmId: String): WritableMap? {
        val alarmData = AlarmStorage.getAlarm(context, alarmId) ?: return null

        return Arguments.createMap().apply {
            putString("id", alarmData.id)
            putMap("schedule", alarmData.schedule)
            putMap("config", alarmData.config)
            putString("nextFireDate", alarmData.nextFireDate.toString())
            putString("capability", "native_alarms")
            putBoolean("isActive", true)
            putString("platformAlarmId", alarmData.id)
        }
    }

    /**
     * Get all alarms
     */
    fun getAllAlarms(): List<WritableMap> {
        val alarms = AlarmStorage.getAllAlarms(context)

        return alarms.map { alarmData ->
            Arguments.createMap().apply {
                putString("id", alarmData.id)
                putMap("schedule", alarmData.schedule)
                putMap("config", alarmData.config)
                putString("nextFireDate", alarmData.nextFireDate.toString())
                putString("capability", "native_alarms")
                putBoolean("isActive", true)
                putString("platformAlarmId", alarmData.id)
            }
        }
    }

    /**
     * Get alarms by category
     */
    fun getAlarmsByCategory(category: String): List<WritableMap> {
        val alarms = AlarmStorage.getAlarmsByCategory(context, category)

        return alarms.map { alarmData ->
            Arguments.createMap().apply {
                putString("id", alarmData.id)
                putMap("schedule", alarmData.schedule)
                putMap("config", alarmData.config)
                putString("nextFireDate", alarmData.nextFireDate.toString())
                putString("capability", "native_alarms")
                putBoolean("isActive", true)
                putString("platformAlarmId", alarmData.id)
            }
        }
    }

    /**
     * Snooze alarm
     */
    fun snoozeAlarm(alarmId: String, minutes: Int): Long? {
        val alarmData = AlarmStorage.getAlarm(context, alarmId) ?: return null

        // Cancel current alarm
        cancelAlarm(alarmId)

        // Calculate snooze time
        val snoozeTime = System.currentTimeMillis() + (minutes * 60 * 1000)

        // Schedule new alarm for snooze time
        val intent = createAlarmIntent(alarmId, alarmData.schedule, alarmData.config)
        val pendingIntent = createPendingIntent(alarmId, intent)

        scheduleExactAlarm(snoozeTime, pendingIntent, useAlarmClock = true)

        // Update storage with new time
        AlarmStorage.saveAlarm(
            context,
            alarmId,
            alarmData.schedule,
            alarmData.config,
            snoozeTime
        )
        return snoozeTime
    }

    // Private helper methods

    private fun scheduleSingleAlarm(
        alarmId: String,
        schedule: ReadableMap,
        config: ReadableMap,
        triggerTime: Long
    ) {
        val intent = createAlarmIntent(alarmId, schedule, config)
        val pendingIntent = createPendingIntent(alarmId, intent)

        scheduleExactAlarm(triggerTime, pendingIntent, useAlarmClock = true)
    }

    private fun scheduleRecurringAlarm(
        alarmId: String,
        schedule: ReadableMap,
        config: ReadableMap,
        triggerTime: Long
    ) {
        val daysOfWeek = schedule.getArray("daysOfWeek")

        if (daysOfWeek == null || daysOfWeek.size() == 0) {
            // Daily alarm
            scheduleSingleAlarm(alarmId, schedule, config, triggerTime)
        } else {
            // Specific days - schedule one alarm per day
            for (i in 0 until daysOfWeek.size()) {
                val day = daysOfWeek.getInt(i)
                val dayAlarmId = "$alarmId-day$day"

                // Calculate next occurrence for this day
                val dayTriggerTime = calculateNextOccurrenceForDay(schedule, day)

                val intent = createAlarmIntent(alarmId, schedule, config)
                val pendingIntent = createPendingIntent(dayAlarmId, intent)

                scheduleExactAlarm(dayTriggerTime, pendingIntent, useAlarmClock = true)
            }
        }
    }

    /**
     * Cancel just the AlarmManager alarm without touching storage
     * Public method for use by AlarmReceiver when cleaning up fired alarms
     */
    fun cancelSingleAlarm(alarmId: String) {
        // IMPORTANT:
        // PendingIntent identity matching includes the Intent's action/data/type/class/categories
        // (extras are ignored). We schedule alarms with action = "com.notifiernativealarms.ALARM_ACTION".
        // If we omit the action here, FLAG_NO_CREATE won't find the existing PendingIntent and
        // the AlarmManager alarm will NOT be cancelled (leading to alarms still firing).
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            action = "com.notifiernativealarms.ALARM_ACTION"
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            alarmId.hashCode(),
            intent,
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        )

        pendingIntent?.let {
            alarmManager.cancel(it)
            it.cancel()
        }
    }

    private fun scheduleExactAlarm(triggerTime: Long, pendingIntent: PendingIntent, useAlarmClock: Boolean) {
        if (useAlarmClock) {
            // Prompt requirement: use AlarmClock for reliable one-time delivery in Doze.
            val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            val showIntent = if (launchIntent != null) {
                PendingIntent.getActivity(
                    context,
                    (pendingIntent.hashCode().toString() + "_show").hashCode(),
                    launchIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
            } else {
                pendingIntent
            }
            alarmManager.setAlarmClock(
                AlarmManager.AlarmClockInfo(triggerTime, showIntent),
                pendingIntent
            )
            return
        }

        // Fallback: exact RTC alarm
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerTime, pendingIntent)
        } else {
            alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerTime, pendingIntent)
        }
    }

    private fun createAlarmIntent(
        alarmId: String,
        schedule: ReadableMap,
        config: ReadableMap
    ): Intent {
        return Intent(context, AlarmReceiver::class.java).apply {
            action = "com.notifiernativealarms.ALARM_ACTION"
            putExtra("alarmId", alarmId)
            putExtra("title", config.getString("title"))
            putExtra("body", config.getString("body"))
            putExtra("sound", config.getString("sound"))
            putExtra("category", config.getString("category"))

            // Optional deep link URL.
            // App-level contract: config.data contains ONLY:
            // { notificationId, title, message, note, link }
            val dataMap = config.getMap("data")
            val deepLinkUrl = try {
                val t = dataMap?.getString("title") ?: config.getString("title")
                val m = dataMap?.getString("message") ?: config.getString("body")
                val note = dataMap?.getString("note") ?: ""
                val link = dataMap?.getString("link") ?: ""

                if (t != null && m != null) {
                    Uri.Builder()
                        .scheme("thenotifier")
                        .authority("notification-display")
                        .appendQueryParameter("title", t)
                        .appendQueryParameter("message", m)
                        .appendQueryParameter("note", note)
                        .appendQueryParameter("link", link)
                        .appendQueryParameter("alarmId", alarmId) // Add alarmId for cleanup
                        .build()
                        .toString()
                } else {
                    null
                }
            } catch (_: Exception) {
                null
            }
            if (deepLinkUrl != null) {
                putExtra("url", deepLinkUrl)
            }

            // Store schedule type for rescheduling
            putExtra("scheduleType", schedule.getString("type"))
        }
    }

    private fun createPendingIntent(alarmId: String, intent: Intent): PendingIntent {
        return PendingIntent.getBroadcast(
            context,
            alarmId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun calculateFixedTriggerTime(schedule: ReadableMap): Long {
        // Check if a specific date is provided (milliseconds timestamp)
        if (schedule.hasKey("date")) {
            val dateTimestamp = schedule.getDouble("date").toLong()
            // Date is provided as milliseconds timestamp
            return dateTimestamp
        }

        // No date provided, use time field to calculate next occurrence
        val timeMap = schedule.getMap("time")
            ?: throw IllegalArgumentException("Time required for fixed alarm")

        val hour = timeMap.getInt("hour")
        val minute = timeMap.getInt("minute")

        val calendar = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }

        // If time has passed today, schedule for tomorrow
        if (calendar.timeInMillis <= System.currentTimeMillis()) {
            calendar.add(Calendar.DAY_OF_YEAR, 1)
        }

        return calendar.timeInMillis
    }

    private fun calculateRecurringTriggerTime(schedule: ReadableMap): Long {
        val timeMap = schedule.getMap("time")
            ?: throw IllegalArgumentException("Time required for recurring alarm")

        val hour = timeMap.getInt("hour")
        val minute = timeMap.getInt("minute")
        val daysOfWeek = schedule.getArray("daysOfWeek")

        val calendar = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }

        if (daysOfWeek == null || daysOfWeek.size() == 0) {
            // Daily alarm
            if (calendar.timeInMillis <= System.currentTimeMillis()) {
                calendar.add(Calendar.DAY_OF_YEAR, 1)
            }
        } else {
            // Find next occurrence based on days of week
            val currentDayOfWeek = calendar.get(Calendar.DAY_OF_WEEK) - 1 // 0 = Sunday
            var daysToAdd = 1

            for (i in 1..7) {
                val checkDay = (currentDayOfWeek + i) % 7

                for (j in 0 until daysOfWeek.size()) {
                    if (daysOfWeek.getInt(j) == checkDay) {
                        daysToAdd = i
                        break
                    }
                }

                if (daysToAdd != 1 || i == 1) break
            }

            calendar.add(Calendar.DAY_OF_YEAR, daysToAdd)
        }

        return calendar.timeInMillis
    }

    private fun calculateNextOccurrenceForDay(schedule: ReadableMap, dayOfWeek: Int): Long {
        val timeMap = schedule.getMap("time")
            ?: throw IllegalArgumentException("Time required")

        val hour = timeMap.getInt("hour")
        val minute = timeMap.getInt("minute")

        val calendar = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }

        val currentDayOfWeek = calendar.get(Calendar.DAY_OF_WEEK) - 1 // 0 = Sunday
        var daysToAdd = (dayOfWeek - currentDayOfWeek + 7) % 7

        // If it's today but time has passed, schedule for next week
        if (daysToAdd == 0 && calendar.timeInMillis <= System.currentTimeMillis()) {
            daysToAdd = 7
        }

        calendar.add(Calendar.DAY_OF_YEAR, daysToAdd)

        return calendar.timeInMillis
    }

    private fun calculateIntervalTriggerTime(schedule: ReadableMap): Long {
        val intervalMinutes = schedule.getInt("intervalMinutes")
        if (intervalMinutes <= 0) {
            throw IllegalArgumentException("Invalid interval")
        }

        val startTime = if (schedule.hasKey("startTime")) {
            schedule.getDouble("startTime").toLong()
        } else {
            System.currentTimeMillis()
        }

        return startTime + (intervalMinutes * 60 * 1000)
    }
}
