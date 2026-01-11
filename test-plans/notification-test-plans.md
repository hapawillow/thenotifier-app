# Notification Test Plans

This document contains comprehensive test plans for scheduling, updating, and deleting notifications, including all options and error scenarios.

## Table of Contents

1. [Scheduling New Notifications](#scheduling-new-notifications)
2. [Updating Upcoming Notifications](#updating-upcoming-notifications)
3. [Deleting Upcoming Notifications](#deleting-upcoming-notifications)
4. [Scheduling Error Scenarios](#scheduling-error-scenarios)
5. [Updating Error Scenarios](#updating-error-scenarios)
6. [Deleting Error Scenarios](#deleting-error-scenarios)

---

## Scheduling New Notifications

### Test Case 1.1: One-time notification (no repeat, no alarm)
**Objective:** Verify basic one-time notification scheduling

**Steps:**
1. Open schedule form
2. Set date/time to 2 hours from now
3. Set repeat option to "Do not repeat"
4. Leave alarm switch OFF
5. Enter message: "Test one-time notification"
6. Optionally add note and link
7. Tap "Schedule Notification"

**Expected Results:**
- Notification scheduled successfully
- `repeatMethod` in DB is `null`
- `repeatOption` in DB is `null` or `'none'`
- `hasAlarm` in DB is `0` or `false`
- Notification appears in upcoming notifications list
- No alert shown

---

### Test Case 1.2: One-time notification with alarm
**Objective:** Verify one-time notification with alarm scheduling

**Steps:**
1. Open schedule form
2. Set date/time to 2 hours from now
3. Set repeat option to "Do not repeat"
4. Turn alarm switch ON
5. Enter message: "Test one-time alarm"
6. Tap "Schedule Notification"

**Expected Results:**
- Notification scheduled successfully
- Alarm scheduled successfully (single AlarmKit fixed alarm)
- `repeatMethod` in DB is `null`
- `hasAlarm` in DB is `1` or `true`
- Notification appears in upcoming notifications list
- No alert shown

---

### Test Case 1.3: Daily repeat - near-term start (uses Expo trigger)
**Objective:** Verify daily repeat with start date < 24 hours uses Expo DAILY trigger

**Steps:**
1. Open schedule form
2. Set date/time to 12 hours from now
3. Set repeat option to "Repeat every day"
4. Turn alarm switch OFF (Expo notification only)
5. Enter message: "Test daily near-term"
6. Tap "Schedule Notification"

**Expected Results:**
- Notification scheduled with Expo DAILY trigger
- No alarms scheduled (alarm switch OFF)
- `repeatMethod` in DB is `'expo'`
- `repeatOption` in DB is `'daily'`
- `notificationTrigger.type` is `'DAILY'`
- `timeZoneMode` in DB is `'dependent'`
- No alert shown (not rolling-window)
- Date/time displayed without timezone suffix in Upcoming tab

---

### Test Case 1.4: Daily repeat - far-term start (uses rolling window)
**Objective:** Verify daily repeat with start date >= 24 hours uses rolling window

**Steps:**
1. Open schedule form
2. Set date/time to 2 days from now
3. Set repeat option to "Repeat every day"
4. Turn alarm switch OFF (Expo notification only)
5. Enter message: "Test daily rolling window"
6. Tap "Schedule Notification"

**Expected Results:**
- DATE notification instances scheduled (iOS: 5, Android: 3)
- No alarms scheduled (alarm switch OFF)
- `repeatMethod` in DB is `'rollingWindow'`
- `repeatOption` in DB is `'daily'`
- `notificationTrigger.type` is `'DATE_WINDOW'`
- `timeZoneMode` in DB is `'dependent'`
- Window size matches platform: iOS=5, Android=3
- Date/time displayed without timezone suffix in Upcoming tab

---

### Test Case 1.5: Weekly repeat - near-term start (uses Expo trigger)
**Objective:** Verify weekly repeat with start date < 7 days uses Expo WEEKLY trigger

**Steps:**
1. Open schedule form
2. Set date/time to 3 days from now
3. Set repeat option to "Repeat every week"
4. Turn alarm switch ON
5. Enter message: "Test weekly near-term"
6. Tap "Schedule Notification"

**Expected Results:**
- Notification scheduled with Expo WEEKLY trigger
- Alarm scheduled with weekly recurrence
- `repeatMethod` in DB is `'expo'`
- `repeatOption` in DB is `'weekly'`
- `notificationTrigger.type` is `'WEEKLY'`
- No alert shown

---

### Test Case 1.6: Weekly repeat - far-term start (uses rolling window)
**Objective:** Verify weekly repeat with start date >= 7 days uses rolling window

**Steps:**
1. Open schedule form
2. Set date/time to 10 days from now
3. Set repeat option to "Repeat every week"
4. Turn alarm switch OFF (Expo notification only)
5. Enter message: "Test weekly rolling window"
6. Tap "Schedule Notification"

**Expected Results:**
- DATE notification instances scheduled (iOS: 3 weeks, Android: 2 weeks)
- No alarms scheduled (alarm switch OFF)
- `repeatMethod` in DB is `'rollingWindow'`
- `repeatOption` in DB is `'weekly'`
- `notificationTrigger.type` is `'DATE_WINDOW'`
- `timeZoneMode` in DB is `'dependent'`
- Window size matches platform: iOS=3, Android=2
- Date/time displayed without timezone suffix in Upcoming tab

---

### Test Case 1.7: Monthly repeat - near-term start (uses Expo trigger)
**Objective:** Verify monthly repeat with start date < 1 month uses Expo MONTHLY trigger

**Steps:**
1. Open schedule form
2. Set date/time to 2 weeks from now
3. Set repeat option to "Repeat every month"
4. Turn alarm switch ON
5. Enter message: "Test monthly near-term"
6. Tap "Schedule Notification"

**Expected Results:**
- Notification scheduled with Expo MONTHLY trigger
- Alarm scheduled with monthly recurrence
- `repeatMethod` in DB is `'expo'`
- `repeatOption` in DB is `'monthly'`
- `notificationTrigger.type` is `'MONTHLY'`
- No alert shown

---

### Test Case 1.8: Monthly repeat - far-term start (uses DATE, migrates to MONTHLY)
**Objective:** Verify monthly repeat with start date >= 1 month uses DATE trigger (will migrate to MONTHLY when it fires)

**Steps:**
1. Open schedule form
2. Set date/time to 6 weeks from now
3. Set repeat option to "Repeat every month"
4. Turn alarm switch OFF (Expo notification only)
5. Enter message: "Test monthly DATE migration"
6. Tap "Schedule Notification"

**Expected Results:**
- Single DATE notification scheduled (NOT rolling window)
- `repeatMethod` in DB is `null` (one-time DATE)
- `repeatOption` in DB is `'monthly'`
- `notificationTrigger.type` is `'DATE'`
- `timeZoneMode` in DB is `'dependent'`
- When notification fires or passes, it should automatically migrate to Expo MONTHLY trigger
- Date/time displayed without timezone suffix in Upcoming tab

---

### Test Case 1.9: Yearly repeat - near-term start (uses Expo trigger)
**Objective:** Verify yearly repeat with start date < 1 year uses Expo YEARLY trigger

**Steps:**
1. Open schedule form
2. Set date/time to 6 months from now
3. Set repeat option to "Repeat every year"
4. Turn alarm switch ON
5. Enter message: "Test yearly near-term"
6. Tap "Schedule Notification"

**Expected Results:**
- Notification scheduled with Expo YEARLY trigger
- Alarm scheduled with yearly recurrence
- `repeatMethod` in DB is `'expo'`
- `repeatOption` in DB is `'yearly'`
- `notificationTrigger.type` is `'YEARLY'`
- No alert shown

---

### Test Case 1.10: Yearly repeat - far-term start (uses DATE, migrates to YEARLY)
**Objective:** Verify yearly repeat with start date >= 1 year uses DATE trigger (will migrate to YEARLY when it fires)

**Steps:**
1. Open schedule form
2. Set date/time to 18 months from now
3. Set repeat option to "Repeat every year"
4. Turn alarm switch OFF (Expo notification only)
5. Enter message: "Test yearly DATE migration"
6. Tap "Schedule Notification"

**Expected Results:**
- Single DATE notification scheduled (NOT rolling window)
- `repeatMethod` in DB is `null` (one-time DATE)
- `repeatOption` in DB is `'yearly'`
- `notificationTrigger.type` is `'DATE'`
- `timeZoneMode` in DB is `'dependent'`
- When notification fires or passes, it should automatically migrate to Expo YEARLY trigger
- Date/time displayed without timezone suffix in Upcoming tab

---

### Test Case 1.11: Calendar event - one-time notification (TIME_INTERVAL)
**Objective:** Verify calendar event notification uses TIME_INTERVAL trigger

**Steps:**
1. Navigate to Calendar tab
2. Select a calendar event
3. Tap "Schedule Notification"
4. Set date/time to 2 hours from now (event start time)
5. Set repeat option to "Do not repeat"
6. Turn alarm switch OFF
7. Enter message (pre-filled from event)
8. Tap "Schedule Notification"

**Expected Results:**
- Notification scheduled with TIME_INTERVAL trigger
- `notificationTrigger.type` is `'TIME_INTERVAL'`
- `timeZoneMode` in DB is `'independent'`
- `createdTimeZoneId` and `createdTimeZoneAbbr` stored in DB
- Date/time displayed WITH timezone suffix in Upcoming tab (e.g., "1/8/2026, 11:15 AM (EST)")
- Notification fires at correct absolute time even if device timezone changes

---

### Test Case 1.12: Calendar event - daily repeat (TIME_INTERVAL rolling window)
**Objective:** Verify calendar event with daily repeat uses TIME_INTERVAL rolling window

**Steps:**
1. Navigate to Calendar tab
2. Select a recurring daily calendar event
3. Tap "Schedule Notification"
4. Set date/time to event start time (2 days from now)
5. Set repeat option to "Repeat every day" (pre-filled)
6. Turn alarm switch OFF
7. Tap "Schedule Notification"

**Expected Results:**
- TIME_INTERVAL rolling window scheduled (iOS: 5 days, Android: 3 days)
- `notificationTrigger.type` is `'TIME_INTERVAL_WINDOW'`
- `timeZoneMode` in DB is `'independent'`
- `createdTimeZoneId` and `createdTimeZoneAbbr` stored in DB
- Date/time displayed WITH timezone suffix in Upcoming tab
- Rolling window replenished automatically when instances fire

---

### Test Case 1.13: Calendar event - monthly repeat (TIME_INTERVAL single, reschedules)
**Objective:** Verify calendar event with monthly repeat uses single TIME_INTERVAL that reschedules

**Steps:**
1. Navigate to Calendar tab
2. Select a recurring monthly calendar event
3. Tap "Schedule Notification"
4. Set date/time to event start time (6 weeks from now)
5. Set repeat option to "Repeat every month" (pre-filled)
6. Turn alarm switch OFF
7. Tap "Schedule Notification"

**Expected Results:**
- Single TIME_INTERVAL notification scheduled
- `notificationTrigger.type` is `'TIME_INTERVAL'`
- `timeZoneMode` in DB is `'independent'`
- When notification fires, automatically schedules next month's TIME_INTERVAL
- Date/time displayed WITH timezone suffix in Upcoming tab

---

### Test Case 1.14: Alarm toggle exclusivity - ON = alarm only
**Objective:** Verify alarm switch ON schedules only alarms, no Expo notifications

**Steps:**
1. Open schedule form
2. Set date/time to 2 hours from now
3. Set repeat option to "Repeat every day"
4. Turn alarm switch ON
5. Enter message: "Test alarm-only"
6. Tap "Schedule Notification"

**Expected Results:**
- Alarm scheduled (NativeAlarmManager)
- NO Expo notification scheduled
- `repeatMethod` in DB is `'alarm'`
- `notificationTrigger` in DB is `null`
- `hasAlarm` in DB is `1` or `true`
- Notification appears in Upcoming tab with alarm icon

---

### Test Case 1.15: Alarm toggle exclusivity - OFF = Expo only
**Objective:** Verify alarm switch OFF schedules only Expo notifications, no alarms

**Steps:**
1. Open schedule form
2. Set date/time to 2 hours from now
3. Set repeat option to "Repeat every day"
4. Turn alarm switch OFF
5. Enter message: "Test expo-only"
6. Tap "Schedule Notification"

**Expected Results:**
- Expo notification scheduled
- NO alarms scheduled
- `hasAlarm` in DB is `0` or `false`
- Notification appears in Upcoming tab WITHOUT alarm icon

---

### Test Case 1.16: Monthly repeat with day 31 (clamping test)
**Objective:** Verify monthly repeat handles day 31 correctly when target month doesn't have 31 days

**Steps:**
1. Open schedule form
2. Set date/time to January 31, next year
3. Set repeat option to "Repeat every month"
4. Enter message: "Test monthly day 31"
5. Tap "Schedule Notification"

**Expected Results:**
- If start < 1mo: Expo MONTHLY trigger scheduled, handles day clamping correctly
- If start >= 1mo: DATE trigger scheduled, will migrate to MONTHLY with correct day clamping
- No errors in console

---

## Updating Upcoming Notifications

### Test Case 2.1: Update one-time notification - change date/time
**Objective:** Verify updating date/time for one-time notification

**Steps:**
1. Schedule a one-time notification for 2 hours from now
2. Open edit form for that notification
3. Change date/time to 5 hours from now
4. Tap "Update Notification"

**Expected Results:**
- Old notification cancelled
- New notification scheduled with updated date/time
- DB updated with new `scheduleDateTime`
- Notification appears in upcoming list with new time

---

### Test Case 2.2: Update one-time notification - change message
**Objective:** Verify updating message for one-time notification

**Steps:**
1. Schedule a one-time notification
2. Open edit form
3. Change message to "Updated message"
4. Tap "Update Notification"

**Expected Results:**
- Notification updated successfully
- DB updated with new message
- Notification shows updated message in list

---

### Test Case 2.3: Update one-time notification - add alarm
**Objective:** Verify adding alarm to existing one-time notification

**Steps:**
1. Schedule a one-time notification without alarm
2. Open edit form
3. Turn alarm switch ON
4. Tap "Update Notification"

**Expected Results:**
- Notification updated
- Alarm scheduled successfully
- `hasAlarm` in DB updated to `1` or `true`

---

### Test Case 2.4: Update one-time notification - remove alarm
**Objective:** Verify removing alarm from existing one-time notification

**Steps:**
1. Schedule a one-time notification with alarm
2. Open edit form
3. Turn alarm switch OFF
4. Tap "Update Notification"

**Expected Results:**
- Notification updated
- Alarm cancelled successfully
- `hasAlarm` in DB updated to `0` or `false`

---

### Test Case 2.5: Update daily rolling-window - change to near-term (migrates to Expo)
**Objective:** Verify updating daily rolling-window notification to near-term start migrates to Expo

**Steps:**
1. Schedule a daily rolling-window notification for 2 days from now
2. Open edit form
3. Change date/time to 12 hours from now
4. Tap "Update Notification"

**Expected Results:**
- All rolling-window instances cancelled
- New Expo DAILY notification scheduled
- `repeatMethod` updated to `'expo'`
- `notificationTrigger.type` updated to `'DAILY'`
- All `repeatNotificationInstance` rows marked cancelled
- Daily alarm instances cancelled and rescheduled

---

### Test Case 2.6: Update daily Expo - change to far-term (migrates to rolling window)
**Objective:** Verify updating daily Expo notification to far-term start migrates to rolling window

**Steps:**
1. Schedule a daily Expo notification for 12 hours from now
2. Open edit form
3. Change date/time to 2 days from now
4. Tap "Update Notification"

**Expected Results:**
- Old Expo notification cancelled
- 14 rolling-window DATE instances scheduled
- `repeatMethod` updated to `'rollingWindow'`
- `notificationTrigger.type` updated to `'DATE_WINDOW'`
- 14 rows in `repeatNotificationInstance` table
- Alert shown: "Daily Notification"

---

### Test Case 2.7: Update daily rolling-window - change message only
**Objective:** Verify updating message for daily rolling-window notification

**Steps:**
1. Schedule a daily rolling-window notification
2. Open edit form
3. Change message only (keep date/time and repeat option same)
4. Tap "Update Notification"

**Expected Results:**
- All rolling-window instances cancelled
- New instances scheduled with updated message
- DB updated with new message
- `repeatMethod` remains `'rollingWindow'`

---

### Test Case 2.8: Update daily rolling-window - disable alarm
**Objective:** Verify disabling alarm for daily rolling-window notification

**Steps:**
1. Schedule a daily rolling-window notification with alarm
2. Open edit form
3. Turn alarm switch OFF
4. Tap "Update Notification"

**Expected Results:**
- All daily alarm instances cancelled
- `hasAlarm` updated to `0` or `false`
- All `dailyAlarmInstance` rows marked cancelled
- Notification instances remain scheduled

---

### Test Case 2.9: Update weekly rolling-window - change repeat option to monthly
**Objective:** Verify changing repeat option from weekly to monthly

**Steps:**
1. Schedule a weekly rolling-window notification
2. Open edit form
3. Change repeat option to "Repeat every month"
4. Tap "Update Notification"

**Expected Results:**
- All weekly rolling instances cancelled
- 4 monthly rolling instances scheduled
- `repeatOption` updated to `'monthly'`
- Window size changes from 4 to 4 (same, but different interval)

---

### Test Case 2.10: Update monthly rolling-window - change day of month
**Objective:** Verify changing day of month for monthly notification

**Steps:**
1. Schedule a monthly rolling-window notification for the 15th
2. Open edit form
3. Change date to the 20th (same month, different day)
4. Tap "Update Notification"

**Expected Results:**
- All old instances cancelled
- New instances scheduled for the 20th of each month
- Day-of-month clamping works correctly

---

### Test Case 2.11: Update yearly rolling-window - change month
**Objective:** Verify changing month for yearly notification

**Steps:**
1. Schedule a yearly rolling-window notification for March 15
2. Open edit form
3. Change date to June 15
4. Tap "Update Notification"

**Expected Results:**
- All old instances cancelled
- New instances scheduled for June 15 of each year
- `scheduleDateTime` updated in DB

---

### Test Case 2.12: Update rolling-window - change time only
**Objective:** Verify changing time (hour/minute) for rolling-window notification

**Steps:**
1. Schedule a daily rolling-window notification for 10:00 AM
2. Open edit form
3. Change time to 3:00 PM (keep date same)
4. Tap "Update Notification"

**Expected Results:**
- All instances cancelled and rescheduled with new time
- DB updated with new `scheduleDateTime`
- All instances fire at 3:00 PM

---

## Deleting Upcoming Notifications

### Test Case 3.1: Delete one-time notification without alarm
**Objective:** Verify deleting one-time notification

**Steps:**
1. Schedule a one-time notification without alarm
2. Open upcoming notifications list
3. Tap delete on the notification
4. Confirm deletion

**Expected Results:**
- Confirmation alert shown
- Notification cancelled from platform
- Notification removed from DB
- Notification removed from list
- Success toast shown

---

### Test Case 3.2: Delete one-time notification with alarm
**Objective:** Verify deleting one-time notification with alarm

**Steps:**
1. Schedule a one-time notification with alarm
2. Open upcoming notifications list
3. Tap delete on the notification
4. Confirm deletion

**Expected Results:**
- Notification cancelled
- Alarm cancelled
- Notification removed from DB
- Notification removed from list

---

### Test Case 3.3: Delete daily Expo notification with alarm
**Objective:** Verify deleting daily Expo notification

**Steps:**
1. Schedule a daily Expo notification (near-term) with alarm
2. Open upcoming notifications list
3. Tap delete on the notification
4. Confirm deletion

**Expected Results:**
- Expo notification cancelled
- All daily alarm instances cancelled
- All `dailyAlarmInstance` rows marked cancelled
- Notification removed from DB and list

---

### Test Case 3.4: Delete daily rolling-window notification with alarm
**Objective:** Verify deleting daily rolling-window notification cancels all instances

**Steps:**
1. Schedule a daily rolling-window notification with alarm
2. Open upcoming notifications list
3. Tap delete on the notification
4. Confirm deletion

**Expected Results:**
- All 14 rolling-window notification instances cancelled
- All daily alarm instances cancelled
- All `repeatNotificationInstance` rows marked cancelled
- All `dailyAlarmInstance` rows marked cancelled
- Notification removed from DB and list

---

### Test Case 3.5: Delete weekly rolling-window notification
**Objective:** Verify deleting weekly rolling-window notification

**Steps:**
1. Schedule a weekly rolling-window notification
2. Open upcoming notifications list
3. Tap delete on the notification
4. Confirm deletion

**Expected Results:**
- All 4 rolling-window instances cancelled
- All `repeatNotificationInstance` rows marked cancelled
- Notification removed from DB and list

---

### Test Case 3.6: Delete monthly rolling-window notification
**Objective:** Verify deleting monthly rolling-window notification

**Steps:**
1. Schedule a monthly rolling-window notification
2. Open upcoming notifications list
3. Tap delete on the notification
4. Confirm deletion

**Expected Results:**
- All 4 rolling-window instances cancelled
- All `repeatNotificationInstance` rows marked cancelled
- Notification removed from DB and list

---

### Test Case 3.7: Delete yearly rolling-window notification
**Objective:** Verify deleting yearly rolling-window notification

**Steps:**
1. Schedule a yearly rolling-window notification
2. Open upcoming notifications list
3. Tap delete on the notification
4. Confirm deletion

**Expected Results:**
- All 2 rolling-window instances cancelled
- All `repeatNotificationInstance` rows marked cancelled
- Notification removed from DB and list

---

### Test Case 3.8: Delete notification - cancel confirmation
**Objective:** Verify cancelling delete confirmation does nothing

**Steps:**
1. Schedule a notification
2. Open upcoming notifications list
3. Tap delete on the notification
4. Tap "Cancel" on confirmation alert

**Expected Results:**
- Alert dismissed
- Notification remains in list
- No changes to DB or platform

---

## Scheduling Error Scenarios

### Test Case 4.1: Schedule notification - missing message
**Objective:** Verify error when message is empty

**Steps:**
1. Open schedule form
2. Set date/time
3. Leave message field empty
4. Tap "Schedule Notification"

**Expected Results:**
- Alert shown: "Error - You forgot the message"
- Notification not scheduled
- Form remains open

---

### Test Case 4.2: Schedule notification - past date
**Objective:** Verify error when date is in the past

**Steps:**
1. Open schedule form
2. Set date/time to 1 hour ago
3. Enter message
4. Tap "Schedule Notification"

**Expected Results:**
- Alert shown: "Error - Select a future date and time more than 1 minute from now"
- Notification not scheduled
- Form remains open

---

### Test Case 4.3: Schedule notification - date too soon (< 1 minute)
**Objective:** Verify error when date is less than 1 minute away

**Steps:**
1. Open schedule form
2. Set date/time to 30 seconds from now
3. Enter message
4. Tap "Schedule Notification"

**Expected Results:**
- Alert shown: "Error - Select a future date and time more than 1 minute from now"
- Notification not scheduled

---

### Test Case 4.4: Schedule notification - notification permission denied
**Objective:** Verify error when notification permission is denied

**Steps:**
1. Deny notification permission in system settings
2. Open schedule form
3. Fill in all fields
4. Tap "Schedule Notification"

**Expected Results:**
- Alert shown: "Notification Permission Required" with instructions
- Notification not scheduled
- Form remains open

---

### Test Case 4.5: Schedule notification with alarm - alarm permission denied
**Objective:** Verify error when alarm permission is denied

**Steps:**
1. Deny alarm permission in system settings
2. Open schedule form
3. Fill in all fields
4. Turn alarm switch ON
5. Tap "Schedule Notification"

**Expected Results:**
- Alert shown: "Alarm Permission Denied" with instructions
- Notification not scheduled
- Form remains open

---

### Test Case 4.6: Schedule rolling-window - exceeds notification limit
**Objective:** Verify error when scheduling rolling window would exceed MAX_SCHEDULED_NOTIFICATION_COUNT

**Steps:**
1. Schedule notifications until near the limit (e.g., 50 notifications on iOS)
2. Open schedule form
3. Set date/time to 2 days from now
4. Set repeat option to "Repeat every day" (requires 14 instances)
5. Enter message
6. Tap "Schedule Notification"

**Expected Results:**
- Alert shown: "Maximum Notifications Reached - Your phone limits the number of notifications that can be scheduled. To schedule this, you will need to delete X notifications"
- X = number needed to delete (e.g., if 51 scheduled and limit is 64, X = 14 - (64 - 51) = 1)
- Notification not scheduled
- Form remains open

---

### Test Case 4.7: Schedule notification - alarm scheduling fails
**Objective:** Verify graceful handling when alarm scheduling fails

**Steps:**
1. Schedule a notification with alarm
2. Simulate alarm scheduling failure (e.g., AlarmKit error)
3. Tap "Schedule Notification"

**Expected Results:**
- Notification scheduled successfully
- Alert shown: "Warning - The notification was scheduled, but there was a problem scheduling the alarm: [error message]"
- `hasAlarm` in DB is `0` or `false` (or remains as attempted)
- Notification appears in list

---

### Test Case 4.8: Schedule rolling-window - partial instance failure
**Objective:** Verify handling when some rolling-window instances fail to schedule

**Steps:**
1. Schedule a daily rolling-window notification
2. Simulate failure for some instances (e.g., 3 out of 14 fail)

**Expected Results:**
- Successful instances scheduled and persisted
- Failed instances logged but don't block overall operation
- Alert shown: "Daily Notification"
- DB shows correct count of scheduled instances

---

## Updating Error Scenarios

### Test Case 5.1: Update notification - missing message
**Objective:** Verify error when updating with empty message

**Steps:**
1. Schedule a notification
2. Open edit form
3. Clear message field
4. Tap "Update Notification"

**Expected Results:**
- Alert shown: "Error - You forgot the message"
- Notification not updated
- Form remains open

---

### Test Case 5.2: Update notification - past date
**Objective:** Verify error when updating to past date

**Steps:**
1. Schedule a notification for future
2. Open edit form
3. Change date/time to 1 hour ago
4. Tap "Update Notification"

**Expected Results:**
- Alert shown: "Error - Select a future date and time more than 1 minute from now"
- Notification not updated
- Original notification remains scheduled

---

### Test Case 5.3: Update notification - date too soon
**Objective:** Verify error when updating to date < 1 minute away

**Steps:**
1. Schedule a notification
2. Open edit form
3. Change date/time to 30 seconds from now
4. Tap "Update Notification"

**Expected Results:**
- Alert shown: "Error - Select a future date and time more than 1 minute from now"
- Notification not updated

---

### Test Case 5.4: Update rolling-window - cancel instance fails
**Objective:** Verify handling when cancelling old instances fails

**Steps:**
1. Schedule a daily rolling-window notification
2. Simulate failure when cancelling old instances during update
3. Open edit form
4. Change message
5. Tap "Update Notification"

**Expected Results:**
- Error logged but update continues
- New instances scheduled
- Old instances remain (may cause duplicates)
- DB updated with new message

---

### Test Case 5.5: Update notification - alarm cancellation fails
**Objective:** Verify handling when alarm cancellation fails during update

**Steps:**
1. Schedule a notification with alarm
2. Simulate alarm cancellation failure
3. Open edit form
4. Turn alarm switch OFF
5. Tap "Update Notification"

**Expected Results:**
- Error logged
- Notification updated
- Alarm may remain scheduled (best-effort cleanup)
- `hasAlarm` updated to `0` or `false` in DB

---

### Test Case 5.6: Update rolling-window - exceeds notification limit
**Objective:** Verify error when update would exceed notification limit

**Steps:**
1. Schedule a daily rolling-window notification
2. Schedule other notifications until near limit
3. Open edit form for rolling-window notification
4. Change message (triggers rescheduling of 14 instances)
5. Tap "Update Notification"

**Expected Results:**
- Alert shown: "Maximum Notifications Reached"
- Update fails
- Original notification remains scheduled
- Form remains open

---

### Test Case 5.7: Update notification - DB update fails
**Objective:** Verify handling when DB update fails

**Steps:**
1. Schedule a notification
2. Simulate DB failure
3. Open edit form
4. Change message
5. Tap "Update Notification"

**Expected Results:**
- Error logged
- Alert shown: "Error - Failed to update notification. Please try again."
- Platform notification may be updated but DB not updated (inconsistent state)
- User can retry

---

### Test Case 5.8: Update daily rolling-window - alarm reschedule fails
**Objective:** Verify rollback when alarm rescheduling fails

**Steps:**
1. Schedule a daily rolling-window notification with alarm
2. Simulate alarm rescheduling failure during update
3. Open edit form
4. Change message
5. Tap "Update Notification"

**Expected Results:**
- Alarm rescheduling fails
- New Expo notification cancelled (rollback)
- Original rolling-window notification remains
- Error logged: "[RepeatMigration] Alarm handling failed"
- Alert shown: "Error - Failed to update notification"

---

## Deleting Error Scenarios

### Test Case 6.1: Delete notification - cancel confirmation
**Objective:** Verify cancelling delete does nothing

**Steps:**
1. Schedule a notification
2. Tap delete
3. Tap "Cancel" on confirmation

**Expected Results:**
- No changes
- Notification remains in list
- No DB changes

---

### Test Case 6.2: Delete rolling-window - instance cancel fails
**Objective:** Verify handling when cancelling instances fails

**Steps:**
1. Schedule a daily rolling-window notification
2. Simulate failure when cancelling some instances
3. Tap delete
4. Confirm deletion

**Expected Results:**
- Successful cancellations proceed
- Failed cancellations logged as errors
- DB rows marked cancelled for successful ones
- Notification removed from DB and list
- Some instances may remain scheduled (orphaned)

---

### Test Case 6.3: Delete notification - platform cancel fails
**Objective:** Verify handling when platform notification cancel fails

**Steps:**
1. Schedule a notification
2. Simulate platform cancel failure
3. Tap delete
4. Confirm deletion

**Expected Results:**
- Error logged
- DB deletion proceeds
- Notification removed from list
- Platform notification may remain (orphaned)

---

### Test Case 6.4: Delete daily notification - alarm cancel fails
**Objective:** Verify handling when alarm cancellation fails

**Steps:**
1. Schedule a daily notification with alarm
2. Simulate alarm cancellation failure
3. Tap delete
4. Confirm deletion

**Expected Results:**
- Error logged: "Failed to cancel daily alarms on delete"
- Notification deleted from DB and list
- Alarms may remain scheduled (orphaned)
- Success toast still shown

---

### Test Case 6.5: Delete notification - DB deletion fails
**Objective:** Verify handling when DB deletion fails

**Steps:**
1. Schedule a notification
2. Simulate DB deletion failure
3. Tap delete
4. Confirm deletion

**Expected Results:**
- Error logged
- Alert shown: "Error - Failed to cancel notification"
- Platform notification cancelled
- DB notification may remain (inconsistent state)

---

### Test Case 6.6: Delete notification - multiple failures
**Objective:** Verify handling when multiple operations fail

**Steps:**
1. Schedule a daily rolling-window notification with alarm
2. Simulate failures for:
   - Some instance cancellations
   - Some alarm cancellations
   - DB deletion
3. Tap delete
4. Confirm deletion

**Expected Results:**
- All errors logged
- Partial cleanup performed
- Alert shown with error
- State may be inconsistent (requires manual cleanup)

---

## Test Execution Notes

### Prerequisites
- iOS device or simulator with iOS 26.0+ for AlarmKit support
- Notification permissions granted
- Alarm permissions granted (for alarm tests)
- Database cleared or known state

### Test Data Setup
- Use consistent test messages: "Test [scenario name]"
- Use predictable dates/times for reproducibility
- Document expected DB state before/after each test

### Verification Points
1. **Platform State**: Check `Notifications.getAllScheduledNotificationsAsync()`
2. **Database State**: Query `scheduledNotification`, `repeatNotificationInstance`, `dailyAlarmInstance` tables
3. **UI State**: Verify upcoming notifications list
4. **Console Logs**: Check for expected log messages and errors

### Common Issues to Watch For
- Orphaned platform notifications not cancelled
- Orphaned DB rows not cleaned up
- Inconsistent `repeatMethod` values
- Missing or incorrect alerts
- Migration not triggering when expected
- Replenisher interfering with migration

### Regression Tests
After implementing fixes, re-run:
- Test Case 1.4 (daily rolling window)
- Test Case 2.5 (migration from rolling to expo)
- Test Case 3.4 (delete rolling window)
- Test Case 4.6 (notification limit)
- Test Case 5.8 (alarm reschedule rollback)

---

## Permission Removal Scenarios

### Test Case 7.1: Notification permission removed - one-time notification
**Objective:** Verify cleanup when notification permission is revoked with one-time notification scheduled

**Prerequisites:**
- Schedule a one-time notification (no repeat, no alarm) scheduled for future
- Notification permission is granted

**Steps:**
1. Verify notification appears in Upcoming tab
2. Verify notification exists in `scheduledNotification` table
3. Verify notification is scheduled in Expo (`Notifications.getAllScheduledNotificationsAsync()`)
4. Go to device Settings > The Notifier > Notifications
5. Disable "Allow Notifications"
6. Return to app (app should come to foreground)

**Expected Results:**
- Alert shown: "Warning" title with message "The Notifier has detected that it no longer has permission to schedule notifications and alarms. As a result, upcoming notifications have been removed."
- All scheduled Expo notifications cancelled (verify `Notifications.getAllScheduledNotificationsAsync()` returns empty)
- Notification moved to Past tab with `cancelledAt` timestamp set
- Notification removed from `scheduledNotification` table
- Notification exists in `archivedNotification` table with `cancelledAt` set
- Upcoming tab shows "No upcoming notifications"
- Past tab shows the cancelled notification
- Alert only shown once (subsequent foregrounds don't show alert)

---

### Test Case 7.2: Notification permission removed - Expo repeating notification
**Objective:** Verify cleanup when notification permission is revoked with Expo repeating notification scheduled

**Prerequisites:**
- Schedule a daily repeating notification (start < 24 hours, uses Expo DAILY trigger)
- Notification permission is granted

**Steps:**
1. Verify notification appears in Upcoming tab
2. Verify `repeatMethod` in DB is `'expo'`
3. Verify single Expo notification scheduled with DAILY trigger
4. Go to device Settings > The Notifier > Notifications
5. Disable "Allow Notifications"
6. Return to app

**Expected Results:**
- Alert shown with notification permission removal message
- Single Expo repeating notification cancelled
- Notification archived with `cancelledAt` set
- Notification removed from `scheduledNotification` table
- Upcoming tab empty
- Past tab shows cancelled notification
- Alert only shown once

---

### Test Case 7.3: Notification permission removed - rolling-window repeating notification
**Objective:** Verify cleanup when notification permission is revoked with rolling-window repeating notification scheduled

**Prerequisites:**
- Schedule a daily repeating notification (start >= 24 hours, uses rolling window)
- Notification permission is granted

**Steps:**
1. Verify notification appears in Upcoming tab
2. Verify `repeatMethod` in DB is `'rollingWindow'`
3. Verify multiple DATE notification instances scheduled (check `repeatNotificationInstance` table)
4. Verify instances exist in Expo scheduled notifications
5. Go to device Settings > The Notifier > Notifications
6. Disable "Allow Notifications"
7. Return to app

**Expected Results:**
- Alert shown with notification permission removal message
- All DATE notification instances cancelled (verify `Notifications.getAllScheduledNotificationsAsync()` returns empty)
- All rows in `repeatNotificationInstance` table marked as inactive (`isActive = 0`, `cancelledAt` set)
- Notification archived with `cancelledAt` set
- Notification removed from `scheduledNotification` table
- Upcoming tab empty
- Past tab shows cancelled notification
- Alert only shown once

---

### Test Case 7.4: Notification permission removed - daily alarm window
**Objective:** Verify cleanup when notification permission is revoked with daily alarm window scheduled

**Prerequisites:**
- Schedule a daily repeating notification with alarm enabled
- Notification permission is granted
- Alarm permission is granted

**Steps:**
1. Verify notification appears in Upcoming tab with alarm icon
2. Verify 14 daily alarm instances exist in `dailyAlarmInstance` table (`isActive = 1`)
3. Verify alarms are scheduled in AlarmKit
4. Go to device Settings > The Notifier > Notifications
5. Disable "Allow Notifications"
6. Return to app

**Expected Results:**
- Alert shown with notification permission removal message
- All Expo notifications cancelled
- All AlarmKit alarms cancelled (verify alarms no longer exist)
- All rows in `dailyAlarmInstance` table marked as inactive (`isActive = 0`, `cancelledAt` set)
- Notification archived with `cancelledAt` set
- Notification removed from `scheduledNotification` table
- Upcoming tab empty
- Past tab shows cancelled notification
- Alert only shown once

---

### Test Case 7.5: Alarm permission removed - one-time alarm
**Objective:** Verify cleanup when alarm permission is revoked but notifications remain enabled

**Prerequisites:**
- Schedule a one-time notification with alarm enabled
- Notification permission is granted
- Alarm permission is granted

**Steps:**
1. Verify notification appears in Upcoming tab with alarm icon
2. Verify `hasAlarm` in DB is `1` or `true`
3. Verify alarm is scheduled in AlarmKit
4. Go to device Settings > The Notifier > Alarms (iOS) or Permissions > Alarms (Android)
5. Disable alarm permission
6. Return to app

**Expected Results:**
- Alert shown: "Warning" title with message "The Notifier has detected that it no longer has permission to schedule alarms. As a result, alarms have been removed from your upcoming notifications."
- Alarm cancelled in AlarmKit (verify alarm no longer exists)
- Notification remains in Upcoming tab but alarm icon disappears
- `hasAlarm` in DB updated to `0` or `false`
- Notification NOT moved to Past tab
- Existing Past/archived notifications remain unchanged
- Alert only shown once

---

### Test Case 7.6: Alarm permission removed - recurring alarm (weekly/monthly/yearly)
**Objective:** Verify cleanup when alarm permission is revoked for recurring alarm

**Prerequisites:**
- Schedule a weekly/monthly/yearly repeating notification with alarm enabled
- Notification permission is granted
- Alarm permission is granted

**Steps:**
1. Verify notification appears in Upcoming tab with alarm icon
2. Verify recurring alarm is scheduled in AlarmKit
3. Go to device Settings > The Notifier > Alarms (iOS) or Permissions > Alarms (Android)
4. Disable alarm permission
5. Return to app

**Expected Results:**
- Alert shown with alarm permission removal message
- Recurring alarm cancelled in AlarmKit
- Notification remains in Upcoming tab but alarm icon disappears
- `hasAlarm` in DB updated to `0` or `false`
- Notification NOT moved to Past tab
- Alert only shown once

---

### Test Case 7.7: Alarm permission removed - daily alarm window
**Objective:** Verify cleanup when alarm permission is revoked for daily alarm window

**Prerequisites:**
- Schedule a daily repeating notification with alarm enabled
- Notification permission is granted
- Alarm permission is granted

**Steps:**
1. Verify notification appears in Upcoming tab with alarm icon
2. Verify 14 daily alarm instances exist in `dailyAlarmInstance` table (`isActive = 1`)
3. Verify alarms are scheduled in AlarmKit
4. Go to device Settings > The Notifier > Alarms (iOS) or Permissions > Alarms (Android)
5. Disable alarm permission
6. Return to app

**Expected Results:**
- Alert shown with alarm permission removal message
- All 14 AlarmKit alarms cancelled (verify alarms no longer exist)
- All rows in `dailyAlarmInstance` table marked as inactive (`isActive = 0`, `cancelledAt` set)
- Notification remains in Upcoming tab but alarm icon disappears
- `hasAlarm` in DB updated to `0` or `false`
- Notification NOT moved to Past tab
- Alert only shown once

---

### Test Case 7.8: Permission restoration - no cleanup
**Objective:** Verify that restoring permissions doesn't trigger cleanup

**Prerequisites:**
- Notification permission was previously removed
- No upcoming notifications exist

**Steps:**
1. Go to device Settings > The Notifier > Notifications
2. Enable "Allow Notifications"
3. Return to app

**Expected Results:**
- No alert shown
- No cleanup performed
- App functions normally

---

### Test Case 7.9: Multiple permission removals - only first triggers alert
**Objective:** Verify that alert is only shown once per permission transition

**Prerequisites:**
- Schedule multiple upcoming notifications (mix of one-time, repeating, with/without alarms)
- Notification permission is granted

**Steps:**
1. Go to device Settings > The Notifier > Notifications
2. Disable "Allow Notifications"
3. Return to app (first foreground)
4. Background app
5. Return to app again (second foreground)

**Expected Results:**
- Alert shown only on first foreground after permission removal
- No alert shown on subsequent foregrounds
- All notifications cleaned up on first foreground

---

### Verification Points for Permission Removal Tests
1. **Platform State**: 
   - Check `Notifications.getAllScheduledNotificationsAsync()` - should be empty after notification permission removal
   - Check AlarmKit alarms - should be cancelled after alarm permission removal
2. **Database State**: 
   - Query `scheduledNotification` table - should be empty after notification permission removal
   - Query `archivedNotification` table - should contain cancelled notifications with `cancelledAt` set
   - Query `repeatNotificationInstance` table - all rows should be inactive after notification permission removal
   - Query `dailyAlarmInstance` table - all rows should be inactive after permission removal
   - Query `appPreferences` table - should contain `lastKnownNotificationPermission` and `lastKnownAlarmPermission`
3. **UI State**: 
   - Upcoming tab should be empty after notification permission removal
   - Past tab should show cancelled notifications after notification permission removal
   - Alarm icons should disappear after alarm permission removal
4. **Alert Behavior**: 
   - Alert shown exactly once per permission transition
   - Alert text matches i18n keys
   - Alert title uses `alertTitles.warning`

---

## Orphan Prevention Validation

### Test Case 8.1: Delete one-time notification with alarm - verify no orphans
**Objective:** Verify that deleting a one-time notification with alarm doesn't leave orphaned alarms on iOS

**Prerequisites:**
- Schedule a one-time notification with alarm enabled
- Verify alarm is scheduled in AlarmKit

**Steps:**
1. Delete the notification from Upcoming tab
2. Wait a few seconds

**Expected Results:**
- Notification removed from Upcoming tab
- **Verification:** Call `Notifications.getAllScheduledNotificationsAsync()` - no notifications with `content.data.notificationId` matching the deleted notification ID
- **Verification:** AlarmKit alarm no longer exists (verify alarm doesn't fire at scheduled time)
- No orphaned notifications or alarms remain

---

### Test Case 8.2: Delete weekly/monthly/yearly notification with alarm - verify no orphans
**Objective:** Verify that deleting recurring (non-daily) notifications with alarms doesn't leave orphaned alarms

**Prerequisites:**
- Schedule a weekly/monthly/yearly notification with alarm enabled
- Verify recurring alarm is scheduled in AlarmKit

**Steps:**
1. Delete the notification from Upcoming tab
2. Wait a few seconds

**Expected Results:**
- Notification removed from Upcoming tab
- **Verification:** Call `Notifications.getAllScheduledNotificationsAsync()` - no notifications with `content.data.notificationId` matching the deleted notification ID
- **Verification:** AlarmKit recurring alarm no longer exists (verify alarm doesn't fire at scheduled times)
- No orphaned notifications or alarms remain

---

### Test Case 8.3: Update notification (change time) - verify old alarms cancelled
**Objective:** Verify that updating a notification properly cancels old alarms before scheduling new ones

**Prerequisites:**
- Schedule a notification with alarm enabled (one-time or recurring)
- Verify alarm is scheduled in AlarmKit

**Steps:**
1. Edit the notification and change the scheduled time
2. Save the update

**Expected Results:**
- Old alarm cancelled in AlarmKit
- New alarm scheduled with updated time
- **Verification:** Only one alarm exists in AlarmKit (the new one)
- **Verification:** Old alarm doesn't fire at original time
- No orphaned alarms remain

---

### Test Case 8.4: Update notification (disable alarm) - verify alarms cancelled
**Objective:** Verify that disabling alarm on an existing notification cancels all associated alarms

**Prerequisites:**
- Schedule a notification with alarm enabled (daily or non-daily)
- Verify alarms are scheduled in AlarmKit

**Steps:**
1. Edit the notification
2. Turn alarm switch OFF
3. Save the update

**Expected Results:**
- All alarms cancelled in AlarmKit (daily instances or single alarm)
- **Verification:** No alarms remain in AlarmKit for this notification
- **Verification:** Alarms don't fire at scheduled times
- Notification remains in Upcoming tab but without alarm icon
- No orphaned alarms remain

---

### Test Case 8.5: Permission cleanup - verify comprehensive cancellation
**Objective:** Verify that permission cleanup cancels all notifications/alarms even if DB state is stale

**Prerequisites:**
- Schedule multiple notifications (mix of one-time, daily, weekly/monthly/yearly)
- Some with alarms, some without
- Manually modify DB to set `hasAlarm=0` on one notification that actually has an alarm (simulate stale state)

**Steps:**
1. Remove notification permission
2. Return to app

**Expected Results:**
- **Verification:** All Expo notifications cancelled (including those with stale DB state)
- **Verification:** All AlarmKit alarms cancelled (including those with stale DB state)
- **Verification:** Call `Notifications.getAllScheduledNotificationsAsync()` - returns empty or no notifications with `content.data.notificationId` matching any deleted notification IDs
- **Verification:** No AlarmKit alarms remain (verify alarms don't fire)
- No orphaned notifications or alarms remain

---

### Verification Steps for Orphan Prevention
1. **After Delete/Update Operations:**
   - Call `Notifications.getAllScheduledNotificationsAsync()` and verify no notifications exist with `content.data.notificationId` matching the deleted/updated notification ID
   - For rolling-window notifications, verify no instance notifications remain
   - Verify AlarmKit alarms no longer exist (check that alarms don't fire at scheduled times)
   - Check that no orphaned alarms appear in AlarmKit inspection tools

2. **After Permission Cleanup:**
   - Call `Notifications.getAllScheduledNotificationsAsync()` - should be empty or contain no notifications related to the app
   - Verify all AlarmKit alarms are cancelled (no alarms fire)
   - Check DB state matches device state (no discrepancies)

3. **Edge Cases:**
   - Test with stale DB state (hasAlarm flag incorrect)
   - Test with inactive daily alarm instances in DB
   - Test with notifications that have been partially cancelled

---

## Startup Orphan Detection & Auto-Heal Scenarios

### Test Case 9.1: Startup orphan detection - orphaned Expo notification
**Objective:** Verify that app startup detects and cancels orphaned platform notifications that don't have a DB parent

**Prerequisites:**
- Schedule a notification via Expo
- Manually delete the DB row from `scheduledNotification` table (simulating DB corruption or manual deletion)

**Steps:**
1. Schedule a one-time notification
2. Verify notification exists in DB (`scheduledNotification` table)
3. Verify notification is scheduled in Expo (`Notifications.getAllScheduledNotificationsAsync()`)
4. Manually delete the DB row (using SQL or DB tool)
5. Restart the app

**Expected Results:**
- App startup logs: "Starting orphan reconciliation"
- Orphaned Expo notification is cancelled
- Log shows: "Cancelled orphaned Expo notification: [identifier]"
- `Notifications.getAllScheduledNotificationsAsync()` no longer contains the orphaned notification
- If `orphanReconcileMode === 'alert'`: Alert shown with reconciliation summary
- If `orphanReconcileMode === 'silent'`: No alert shown (default)

---

### Test Case 9.2: Startup orphan detection - orphaned rolling-window instance
**Objective:** Verify that app startup detects and cancels orphaned rolling-window notification instances

**Prerequisites:**
- Schedule a daily rolling-window notification
- Manually delete the parent DB row but leave instance notifications scheduled

**Steps:**
1. Schedule a daily rolling-window notification (start >= 24 hours)
2. Verify multiple DATE notification instances are scheduled
3. Verify instances exist in `repeatNotificationInstance` table
4. Manually delete parent from `scheduledNotification` table
5. Restart the app

**Expected Results:**
- App startup detects orphaned instances
- All orphaned rolling-window instances are cancelled
- `Notifications.getAllScheduledNotificationsAsync()` no longer contains orphaned instances
- Log shows cancellation of orphaned instances

---

### Test Case 9.3: Startup orphan detection - orphaned daily alarm instance
**Objective:** Verify that app startup detects and cancels orphaned daily alarm instances

**Prerequisites:**
- Schedule a daily notification with alarm (using daily window strategy)
- Manually delete the parent DB row but leave alarm instances scheduled

**Steps:**
1. Schedule a daily notification with alarm
2. Verify 14 alarm instances exist in `dailyAlarmInstance` table
3. Verify alarms are scheduled in AlarmKit
4. Manually delete parent from `scheduledNotification` table
5. Restart the app

**Expected Results:**
- App startup detects orphaned alarm instances
- All orphaned daily alarm instances are cancelled
- AlarmKit alarms are cancelled
- DB `dailyAlarmInstance` rows are marked as cancelled
- Log shows cancellation of orphaned alarms

---

### Test Case 9.4: Startup auto-heal - missing Expo repeating notification
**Objective:** Verify that app startup reschedules missing Expo repeating notifications

**Prerequisites:**
- Schedule a daily Expo repeating notification (`repeatMethod === 'expo'`)
- Manually cancel the platform notification but keep DB row

**Steps:**
1. Schedule a daily Expo repeating notification (start < 24 hours)
2. Verify `repeatMethod` in DB is `'expo'`
3. Verify single Expo DAILY notification is scheduled
4. Manually cancel the Expo notification (using `Notifications.cancelScheduledNotificationAsync()`)
5. Verify notification no longer exists in platform
6. Restart the app

**Expected Results:**
- App startup detects missing platform notification
- Missing Expo repeating notification is rescheduled
- Log shows: "Expo repeating notification missing for [id], will be handled by replenishers"
- Single Expo DAILY notification exists after startup
- Replenishers ensure notification is restored

---

### Test Case 9.5: Startup auto-heal - missing rolling-window instances
**Objective:** Verify that app startup replenishes missing rolling-window notification instances

**Prerequisites:**
- Schedule a daily rolling-window notification
- Manually cancel some instances but keep parent DB row

**Steps:**
1. Schedule a daily rolling-window notification
2. Verify 14 DATE notification instances are scheduled
3. Manually cancel 5 instances
4. Verify only 9 instances remain
5. Restart the app

**Expected Results:**
- App startup calls `ensureRollingWindowNotificationInstances()`
- Missing rolling-window instances are rescheduled
- Window size is restored to 14 instances
- Log shows rescheduling activity

---

### Test Case 9.6: Startup auto-heal - missing daily alarm window instances
**Objective:** Verify that app startup replenishes missing daily alarm window instances

**Prerequisites:**
- Schedule a daily notification with alarm (daily window strategy)
- Manually cancel some alarm instances but keep parent DB row

**Steps:**
1. Schedule a daily notification with alarm
2. Verify 14 alarm instances exist in `dailyAlarmInstance` table
3. Manually cancel 5 alarm instances
4. Verify only 9 instances remain
5. Restart the app

**Expected Results:**
- App startup calls `ensureDailyAlarmWindowForAllNotifications()`
- Missing daily alarm instances are rescheduled
- Window size is restored to 14 alarms
- Log shows rescheduling activity

---

### Test Case 9.7: Startup auto-heal - missing native recurring daily alarm
**Objective:** Verify that app startup detects and handles missing native recurring daily alarms

**Prerequisites:**
- Schedule a daily notification with alarm using native recurring strategy (if implemented)
- Manually cancel the recurring alarm but keep DB row

**Steps:**
1. Schedule a daily notification with native recurring alarm
2. Verify recurring alarm exists in AlarmKit
3. Manually cancel the recurring alarm
4. Verify alarm no longer exists
5. Restart the app

**Expected Results:**
- App startup detects missing recurring alarm
- Missing recurring alarm is rescheduled (if supported)
- Or log indicates that rescheduling is handled by scheduling logic
- Recurring alarm exists after startup

---

### Test Case 9.8: Startup reconciliation - UX toggle (silent vs alert)
**Objective:** Verify that UX toggle controls whether alerts are shown during reconciliation

**Prerequisites:**
- Set `orphanReconcileMode` preference

**Steps:**
1. Set `orphanReconcileMode` to `'silent'` (default)
2. Create orphaned notification scenario
3. Restart the app
4. Verify no alert is shown
5. Set `orphanReconcileMode` to `'alert'`
6. Create another orphaned notification scenario
7. Restart the app

**Expected Results:**
- When mode is `'silent'`: No alert shown, reconciliation happens silently
- When mode is `'alert'`: Alert shown with reconciliation summary if actions were taken
- Logs show reconciliation activity in both cases
- `setOrphanReconcileMode()` function allows toggling the mode

---

### Test Case 9.9: Foreground reconciliation - lighter variant
**Objective:** Verify that foreground reconciliation performs lighter checks (only cancel orphans + ensure DB-scheduled exist)

**Prerequisites:**
- App is running
- Create orphaned notification scenario

**Steps:**
1. Schedule a notification
2. Manually delete DB row
3. Background the app
4. Return app to foreground

**Expected Results:**
- Foreground reconciliation runs (`reconcileOrphansOnForeground()`)
- Orphaned notifications are cancelled
- Missing platform items are rescheduled
- Lighter variant doesn't perform full DB cleanup sweep
- Log shows foreground reconciliation activity

---

### Test Case 9.10: Reconciliation with permission denied
**Objective:** Verify that reconciliation handles permission-denied scenarios gracefully

**Prerequisites:**
- Notification or alarm permissions denied

**Steps:**
1. Revoke notification permission
2. Restart the app
3. Verify reconciliation runs
4. Restore notification permission
5. Revoke alarm permission
6. Restart the app

**Expected Results:**
- Reconciliation runs even with permissions denied
- Orphan cancellation still works (cancelling doesn't require permissions)
- Auto-heal is skipped when permissions are denied
- Log shows permission status and skips rescheduling when appropriate
- No errors thrown due to permission denial

---

## Begin-Date Correctness Scenarios

### Test Case 10.1: Daily repeat - begin date >24h in future
**Objective:** Verify that daily repeats scheduled with a begin date more than 24 hours in the future start exactly on that date, not earlier

**Prerequisites:**
- Current day is Monday
- Schedule a daily repeat notification with alarm
- Set begin date to Wednesday 9:30am (more than 24h in future)

**Steps:**
1. On Monday, schedule a daily repeat notification with alarm
2. Set begin date to Wednesday 9:30am
3. Verify notification appears in Upcoming tab
4. Wait until Tuesday 9:30am
5. Verify notification/alarm does NOT fire on Tuesday
6. Wait until Wednesday 9:30am
7. Verify notification/alarm fires on Wednesday

**Expected Results:**
- Notification/alarm does NOT fire on Tuesday (1 day early)
- Notification/alarm fires exactly on Wednesday 9:30am (selected begin date)
- Log shows: "using rollingWindow (selected date does not match next occurrence)" or similar
- First scheduled occurrence in platform is exactly Wednesday 9:30am

---

### Test Case 10.2: Daily repeat - begin date <24h in future (next occurrence)
**Objective:** Verify that daily repeats scheduled with a begin date that matches the next daily occurrence use Expo DAILY trigger correctly

**Prerequisites:**
- Current time is Monday 2:00pm
- Schedule a daily repeat notification
- Set begin date to Tuesday 9:30am (<24h but matches next occurrence)

**Steps:**
1. On Monday 2:00pm, schedule a daily repeat notification
2. Set begin date to Tuesday 9:30am
3. Verify notification appears in Upcoming tab
4. Wait until Tuesday 9:30am
5. Verify notification fires on Tuesday

**Expected Results:**
- Notification fires exactly on Tuesday 9:30am
- Log shows: "using Expo DAILY trigger (selected date matches next occurrence)"
- Expo DAILY trigger is used (not rolling window)

---

### Test Case 10.3: Weekly repeat - begin date = next week's weekday
**Objective:** Verify that weekly repeats scheduled for next week's weekday do not fire this week

**Prerequisites:**
- Current day is Monday
- Schedule a weekly repeat notification with alarm
- Set begin date to next Wednesday 10:30am

**Steps:**
1. On Monday, schedule a weekly repeat notification with alarm
2. Set begin date to next Wednesday 10:30am (7+ days in future)
3. Verify notification appears in Upcoming tab
4. Wait until this Wednesday 10:30am
5. Verify notification/alarm does NOT fire this Wednesday
6. Wait until next Wednesday 10:30am
7. Verify notification/alarm fires on next Wednesday

**Expected Results:**
- Notification/alarm does NOT fire on this Wednesday (1 week early)
- Notification/alarm fires exactly on next Wednesday 10:30am (selected begin date)
- Log shows: "using rollingWindow (selected date does not match next occurrence)"
- First scheduled occurrence in platform is exactly next Wednesday 10:30am
- Expo WEEKLY trigger weekday mapping is correct (expoWeekday logged)

---

### Test Case 10.4: Weekly repeat - begin date = this week's weekday (next occurrence)
**Objective:** Verify that weekly repeats scheduled for this week's weekday use Expo WEEKLY trigger correctly

**Prerequisites:**
- Current day is Monday
- Schedule a weekly repeat notification
- Set begin date to this Wednesday 10:30am (matches next weekly occurrence)

**Steps:**
1. On Monday, schedule a weekly repeat notification
2. Set begin date to this Wednesday 10:30am
3. Verify notification appears in Upcoming tab
4. Wait until Wednesday 10:30am
5. Verify notification fires on Wednesday

**Expected Results:**
- Notification fires exactly on Wednesday 10:30am
- Log shows: "using Expo WEEKLY trigger (selected date matches next occurrence)"
- Expo WEEKLY trigger is used with correct weekday mapping (expoWeekday: 4 for Wednesday)
- Not rolling window

---

### Test Case 10.5: Calendar flow - event repeats Tue, user changes to Wed
**Objective:** Verify that when a calendar event repeats on Tuesday but user changes begin date to Wednesday, it does not fire on Tuesday

**Prerequisites:**
- Calendar event repeats every Tuesday
- User imports event and modifies begin date to Wednesday

**Steps:**
1. Import calendar event that repeats every Tuesday
2. Modify begin date to Wednesday (same week or next week)
3. Schedule notification with alarm
4. Wait until Tuesday
5. Verify notification/alarm does NOT fire on Tuesday
6. Wait until Wednesday
7. Verify notification/alarm fires on Wednesday

**Expected Results:**
- Notification/alarm does NOT fire on Tuesday (original calendar day)
- Notification/alarm fires exactly on Wednesday (user-selected begin date)
- Log shows correct weekday mapping and strategy selection
- First occurrence is exactly on selected Wednesday

---

### Test Case 10.6: Monthly repeat - begin date correctness
**Objective:** Verify that monthly repeats begin exactly on the selected date

**Prerequisites:**
- Current date is January 15th
- Schedule a monthly repeat notification
- Set begin date to March 15th (more than 1 month in future)

**Steps:**
1. On January 15th, schedule a monthly repeat notification
2. Set begin date to March 15th
3. Verify notification appears in Upcoming tab
4. Wait until February 15th
5. Verify notification does NOT fire in February
6. Wait until March 15th
7. Verify notification fires on March 15th

**Expected Results:**
- Notification does NOT fire in February (1 month early)
- Notification fires exactly on March 15th (selected begin date)
- First occurrence is exactly on selected date

---

### Test Case 10.7: Yearly repeat - begin date correctness
**Objective:** Verify that yearly repeats begin exactly on the selected date and month mapping is correct

**Prerequisites:**
- Current date is January 2024
- Schedule a yearly repeat notification
- Set begin date to March 2025 (more than 1 year in future)

**Steps:**
1. In January 2024, schedule a yearly repeat notification
2. Set begin date to March 15, 2025
3. Verify notification appears in Upcoming tab
4. Wait until March 2024
5. Verify notification does NOT fire in March 2024
6. Wait until March 2025
7. Verify notification fires on March 15, 2025

**Expected Results:**
- Notification does NOT fire in March 2024 (1 year early)
- Notification fires exactly on March 15, 2025 (selected begin date)
- Log shows correct month mapping (expoMonth: 3 for March, not 2)
- First occurrence is exactly on selected date

---

### Test Case 10.8: Daily alarm window - begin date correctness
**Objective:** Verify that daily alarm windows start exactly on the selected begin date

**Prerequisites:**
- Current day is Monday
- Schedule a daily repeat notification with alarm
- Set begin date to Wednesday 9:30am

**Steps:**
1. On Monday, schedule a daily repeat notification with alarm
2. Set begin date to Wednesday 9:30am
3. Verify 14 alarm instances are scheduled
4. Check first alarm instance fireDateTime in DB
5. Wait until Tuesday 9:30am
6. Verify alarm does NOT fire on Tuesday
7. Wait until Wednesday 9:30am
8. Verify alarm fires on Wednesday

**Expected Results:**
- First alarm instance fireDateTime in DB is exactly Wednesday 9:30am
- Alarm does NOT fire on Tuesday (1 day early)
- Alarm fires exactly on Wednesday 9:30am (selected begin date)
- All 14 alarm instances are scheduled starting from Wednesday

---

### Test Case 10.9: Rolling-window notification instances - begin date correctness
**Objective:** Verify that rolling-window notification instances start exactly on the selected begin date

**Prerequisites:**
- Current day is Monday
- Schedule a daily rolling-window notification
- Set begin date to Wednesday 9:30am

**Steps:**
1. On Monday, schedule a daily rolling-window notification
2. Set begin date to Wednesday 9:30am
3. Verify 14 notification instances are scheduled
4. Check first instance fireDateTime in DB
5. Check platform scheduled notifications
6. Wait until Tuesday 9:30am
7. Verify notification does NOT fire on Tuesday
8. Wait until Wednesday 9:30am
9. Verify notification fires on Wednesday

**Expected Results:**
- First instance fireDateTime in DB is exactly Wednesday 9:30am
- First platform scheduled notification is exactly Wednesday 9:30am
- Notification does NOT fire on Tuesday (1 day early)
- Notification fires exactly on Wednesday 9:30am (selected begin date)
- All 14 instances are scheduled starting from Wednesday

---

### Test Case 10.10: Logging and observability
**Objective:** Verify that scheduling logs include begin-date correctness information

**Prerequisites:**
- Schedule various repeat notifications with different begin dates

**Steps:**
1. Schedule daily repeat with begin date >24h in future
2. Schedule daily repeat with begin date matching next occurrence
3. Schedule weekly repeat with begin date = next week
4. Schedule weekly repeat with begin date = this week
5. Check logs for each scheduling operation

**Expected Results:**
- Logs show selected begin date (ISO and local)
- Logs show computed next occurrence (for daily/weekly)
- Logs show chosen strategy (Expo repeat vs rolling window)
- Logs show weekday/month mapping values (expoWeekday, expoMonth)
- Logs show reason for strategy selection (matches next occurrence vs doesn't match)

---

## Past Tab Drawer Height Scenarios

### Test Case 11.1: Past drawer - note with blank lines
**Objective:** Verify that Past tab reveal drawer expands to show entire note including blank lines

**Prerequisites:**
- A notification exists in Past tab (archived or repeat occurrence)
- Notification has a note with blank lines (e.g., "Line 1\n\nLine 2")

**Steps:**
1. Navigate to Past tab
2. Find notification with note containing blank lines
3. Tap reveal symbol (chevron) to expand drawer
4. Observe drawer height and note content

**Expected Results:**
- Drawer expands to full height showing entire note
- Blank line between "Line 1" and "Line 2" is visible
- "Line 2" is fully visible (not cut off)
- Drawer height is stable on first expand (no "measured too small then stuck")

---

### Test Case 11.2: Past drawer - note with many newlines
**Objective:** Verify that Past tab drawer scales correctly for notes with multiple paragraphs

**Prerequisites:**
- A notification exists in Past tab
- Notification has a note with 6-10 lines including blank lines

**Steps:**
1. Navigate to Past tab
2. Find notification with multi-paragraph note
3. Tap reveal symbol to expand drawer
4. Scroll within drawer if needed
5. Verify all lines are visible

**Expected Results:**
- Drawer expands to accommodate all note content
- All lines including blank lines are visible
- No content is cut off at bottom
- Drawer height accurately reflects full content height

---

### Test Case 11.3: Past drawer - mixed content (repeat + note + link)
**Objective:** Verify that Past tab drawer includes all expandable content rows in height calculation

**Prerequisites:**
- A notification exists in Past tab
- Notification has repeat option, note with blank lines, and link

**Steps:**
1. Navigate to Past tab
2. Find notification with repeat + note + link
3. Tap reveal symbol to expand drawer
4. Verify all content is visible

**Expected Results:**
- Drawer expands to show all rows (repeat, note, link)
- Note with blank lines displays fully
- All content is visible without scrolling
- Drawer height includes all rows plus padding

---

### Test Case 11.4: Upcoming drawer - note with blank lines
**Objective:** Verify that Upcoming tab reveal drawer also handles blank lines correctly

**Prerequisites:**
- A scheduled notification exists in Upcoming tab
- Notification has a note with blank lines

**Steps:**
1. Navigate to Upcoming tab
2. Find scheduled notification with note containing blank lines
3. Tap reveal symbol to expand drawer
4. Observe drawer height and note content

**Expected Results:**
- Drawer expands to full height showing entire note
- Blank lines are visible
- All note content is visible (not cut off)
- Drawer height is stable on first expand

---

### Test Case 11.5: Drawer height measurement - first expand accuracy
**Objective:** Verify that drawer height is measured correctly on first expand (not constrained by animation)

**Prerequisites:**
- Notification in Past or Upcoming tab with note containing blank lines

**Steps:**
1. Navigate to appropriate tab
2. Find notification with multi-line note
3. Tap reveal symbol to expand drawer (first time)
4. Observe if drawer height is correct immediately
5. Collapse and expand again
6. Verify height is consistent

**Expected Results:**
- Drawer height is correct on first expand (not too small)
- Height is consistent on subsequent expands
- No "jump" or resize after initial measurement
- Measurement view correctly calculates full content height

---

## Past Tab Drawer - Repeat Occurrence Display

### Test Case 12.1: Past drawer - repeat occurrence shows Repeat row
**Objective:** Verify that Past tab reveal drawer for repeat occurrences displays the Repeat row with correct formatting

**Prerequisites:**
- A daily repeat notification has fired at least once
- The repeat occurrence appears in Past tab

**Steps:**
1. Navigate to Past tab
2. Find a repeat occurrence item (from a daily/weekly/monthly/yearly repeat)
3. Tap reveal symbol (chevron) to expand drawer
4. Observe drawer content

**Expected Results:**
- Drawer shows "Repeat:" label
- Drawer shows formatted repeat string (e.g., "Repeats daily at 10:00 AM")
- Repeat information is displayed even if parent notification was deleted/archived
- Format matches expected format for the repeat type (daily/weekly/monthly/yearly)

---

### Test Case 12.2: Past drawer - repeat occurrence with note shows both Repeat and Note rows
**Objective:** Verify that Past tab drawer for repeat occurrences displays both Repeat and Note rows correctly

**Prerequisites:**
- A daily repeat notification with a note containing blank lines has fired
- The note format is: "Line 1\n\nLine 2"

**Steps:**
1. Navigate to Past tab
2. Find the repeat occurrence item
3. Tap reveal symbol to expand drawer
4. Verify all content is visible

**Expected Results:**
- Drawer shows "Repeat:" row with formatted repeat string
- Drawer shows "Note:" row
- Note displays full content including blank line between "Line 1" and "Line 2"
- "Line 2" is fully visible (not cut off)
- Drawer height accommodates all content (Repeat + Note rows)

---

### Test Case 12.3: Past drawer - ID collision prevention
**Objective:** Verify that Past tab drawer state (expanded/collapsed, height) is not affected by ID collisions between archived and repeat occurrence items

**Prerequisites:**
- Both archivedNotification and repeatNotificationOccurrence tables have items with the same numeric ID (e.g., both have id=1)

**Steps:**
1. Navigate to Past tab
2. Expand the archived item with id=1
3. Collapse it
4. Expand the repeat occurrence item with id=1
5. Verify drawer state is independent

**Expected Results:**
- Expanding archived item does not affect repeat occurrence item
- Expanding repeat occurrence item does not affect archived item
- Each item maintains its own drawer height measurement
- No state leakage between items with same numeric ID

---

## Notification Detail Screen Navigation

### Test Case 13.1: System notification tap - daily repeat with alarm (no reopen loop)
**Objective:** Verify that tapping a system notification for a daily repeat notification with alarm opens the detail screen once and does not reopen after closing

**Prerequisites:**
- A daily repeat notification with alarm enabled is scheduled
- Notification has fired and appears as a system notification

**Steps:**
1. Wait for the daily repeat notification to fire
2. Tap the system notification banner/lockscreen notification
3. Verify notification detail screen opens
4. Tap the Close button
5. Verify detail screen closes
6. Wait 2-3 seconds
7. Verify detail screen does NOT reopen automatically

**Expected Results:**
- Detail screen opens once when notification is tapped
- Detail screen closes when Close button is tapped
- Detail screen does NOT reopen after closing
- No loop of closing and reopening

---

### Test Case 13.2: System notification tap - weekly repeat with alarm (no reopen loop)
**Objective:** Verify that tapping a system notification for a weekly repeat notification with alarm does not cause reopen loop

**Prerequisites:**
- A weekly repeat notification with alarm enabled is scheduled
- Notification has fired and appears as a system notification

**Steps:**
1. Wait for the weekly repeat notification to fire
2. Tap the system notification
3. Verify notification detail screen opens
4. Tap the Close button
5. Verify detail screen closes and does NOT reopen

**Expected Results:**
- Detail screen opens once
- Detail screen closes when Close button is tapped
- Detail screen does NOT reopen after closing

---

### Test Case 13.3: System notification tap - one-time notification (no regression)
**Objective:** Verify that one-time notifications continue to work correctly (no regression)

**Prerequisites:**
- A one-time notification (no repeat, no alarm) is scheduled
- Notification has fired and appears as a system notification

**Steps:**
1. Wait for the one-time notification to fire
2. Tap the system notification
3. Verify notification detail screen opens
4. Tap the Close button
5. Verify detail screen closes and does NOT reopen

**Expected Results:**
- Detail screen opens once
- Detail screen closes when Close button is tapped
- Detail screen does NOT reopen after closing
- Behavior matches previous working state

---

### Test Case 13.4: Multiple notification responses deduplication
**Objective:** Verify that multiple notification responses for the same parent notification are deduplicated correctly

**Prerequisites:**
- A daily repeat notification with alarm enabled is scheduled
- Both notification and alarm fire at the same time (or very close together)

**Steps:**
1. Wait for the notification and alarm to fire simultaneously
2. Tap one of the system notifications
3. Verify detail screen opens once (not multiple times)
4. Tap Close button
5. Verify detail screen closes and does NOT reopen

**Expected Results:**
- Only one detail screen opens even if multiple notification responses are received
- Detail screen closes normally
- No reopen loop occurs
- Deduplication works based on parent notification ID, not instance IDs

---

## Cold Start Notification Navigation

### Test Case 14.1: Cold start - notification tap shows detail screen (production build)
**Objective:** Verify that tapping a notification on cold start (app closed) navigates to notification detail screen, not home screen

**Prerequisites:**
- App is completely closed (not in background)
- A one-time notification is scheduled and has fired
- Test in production build (no dev menu)

**Steps:**
1. Ensure app is completely closed
2. Wait for notification to fire
3. Tap the notification banner/lockscreen notification
4. Observe app launch sequence

**Expected Results:**
- Splash screen appears briefly
- Notification detail screen appears (NOT home screen)
- Detail screen shows correct notification content (title, message, note, link)
- User can close detail screen and navigate normally

---

### Test Case 14.2: Cold start - notification tap shows detail screen (dev build with dev menu)
**Objective:** Verify that tapping a notification on cold start works correctly even when Expo dev menu appears

**Prerequisites:**
- App is completely closed
- A one-time notification is scheduled and has fired
- Test in dev build (`npx expo run:ios --device`)

**Steps:**
1. Ensure app is completely closed
2. Wait for notification to fire
3. Tap the notification banner/lockscreen notification
4. Observe Expo dev menu appears
5. Dismiss the dev menu
6. Observe app screen

**Expected Results:**
- Splash screen appears
- Expo dev menu appears on top
- After dismissing dev menu, notification detail screen is visible (NOT home screen)
- Detail screen shows correct notification content
- User can close detail screen and navigate normally

---

### Test Case 14.3: Cold start - repeat notification tap shows detail screen
**Objective:** Verify that tapping a repeat notification on cold start also shows detail screen correctly

**Prerequisites:**
- App is completely closed
- A daily repeat notification is scheduled and has fired
- Test in production build

**Steps:**
1. Ensure app is completely closed
2. Wait for daily repeat notification to fire
3. Tap the notification banner
4. Observe app launch sequence

**Expected Results:**
- Splash screen appears briefly
- Notification detail screen appears (NOT home screen)
- Detail screen shows correct notification content
- No reopen loop occurs when closing detail screen

---

### Test Case 14.4: App icon launch - shows home screen (no regression)
**Objective:** Verify that opening app via app icon still shows home screen (not affected by notification navigation changes)

**Prerequisites:**
- App is completely closed
- No pending notifications

**Steps:**
1. Ensure app is completely closed
2. Tap the app icon (not a notification)
3. Observe app launch sequence

**Expected Results:**
- Splash screen appears briefly
- Home screen appears (NOT notification detail screen)
- App functions normally
- No navigation to notification detail screen

---

### Test Case 14.5: Foreground notification tap - shows detail screen as modal (no regression)
**Objective:** Verify that tapping a notification when app is running continues to work correctly

**Prerequisites:**
- App is running in foreground or background
- A notification fires

**Steps:**
1. Ensure app is running (foreground or background)
2. Wait for notification to fire
3. Tap the notification banner
4. Observe navigation behavior

**Expected Results:**
- Notification detail screen appears as modal overlay
- Detail screen shows correct notification content
- User can close detail screen and return to previous screen
- Behavior matches previous working state

---

### Test Case 14.6: Cold start - notification WITHOUT alarm
**Objective:** Verify that tapping a notification without alarm on cold start shows detail screen

**Prerequisites:**
- App is completely closed
- A one-time notification WITHOUT alarm is scheduled and has fired
- Test in production build

**Steps:**
1. Ensure app is completely closed
2. Wait for notification (without alarm) to fire
3. Tap the notification banner immediately
4. Observe app launch sequence

**Expected Results:**
- Splash screen appears briefly
- Notification detail screen appears (NOT home screen)
- Detail screen shows correct notification content
- No home screen flash before detail screen

---

### Test Case 14.7: Cold start - notification WITH alarm (tap banner directly)
**Objective:** Verify that tapping a notification banner directly (without closing alarm first) on cold start shows detail screen

**Prerequisites:**
- App is completely closed
- A one-time notification WITH alarm is scheduled and has fired
- Alarm is currently showing/active
- Test in production build

**Steps:**
1. Ensure app is completely closed
2. Wait for notification with alarm to fire
3. Tap the notification banner directly (DO NOT close alarm first)
4. Observe app launch sequence

**Expected Results:**
- Splash screen appears briefly
- Notification detail screen appears (NOT home screen)
- Detail screen shows correct notification content
- No home screen flash before detail screen
- Works even when alarm is still active

---

### Test Case 14.8: Cold start - notification WITH alarm (close alarm then tap banner)
**Objective:** Verify that closing alarm first then tapping notification banner still works (regression test)

**Prerequisites:**
- App is completely closed
- A one-time notification WITH alarm is scheduled and has fired
- Test in production build

**Steps:**
1. Ensure app is completely closed
2. Wait for notification with alarm to fire
3. Close/dismiss the alarm first
4. Then tap the notification banner
5. Observe app launch sequence

**Expected Results:**
- Splash screen appears briefly
- Notification detail screen appears (NOT home screen)
- Detail screen shows correct notification content
- Behavior matches previous working state (no regression)

