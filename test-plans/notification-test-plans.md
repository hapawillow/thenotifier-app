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
4. Turn alarm switch ON
5. Enter message: "Test daily near-term"
6. Tap "Schedule Notification"

**Expected Results:**
- Notification scheduled with Expo DAILY trigger
- Daily alarm window scheduled (14 fixed alarms)
- `repeatMethod` in DB is `'expo'`
- `repeatOption` in DB is `'daily'`
- `notificationTrigger.type` is `'DAILY'`
- No alert shown (not rolling-window)

---

### Test Case 1.4: Daily repeat - far-term start (uses rolling window)
**Objective:** Verify daily repeat with start date >= 24 hours uses rolling window

**Steps:**
1. Open schedule form
2. Set date/time to 2 days from now
3. Set repeat option to "Repeat every day"
4. Turn alarm switch ON
5. Enter message: "Test daily rolling window"
6. Tap "Schedule Notification"

**Expected Results:**
- 14 DATE notification instances scheduled
- Daily alarm window scheduled (14 fixed alarms)
- `repeatMethod` in DB is `'rollingWindow'`
- `repeatOption` in DB is `'daily'`
- `notificationTrigger.type` is `'DATE_WINDOW'`
- Alert shown: "Daily Notification" with message about using app every two weeks
- 14 rows in `repeatNotificationInstance` table

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
4. Turn alarm switch ON
5. Enter message: "Test weekly rolling window"
6. Tap "Schedule Notification"

**Expected Results:**
- 4 DATE notification instances scheduled (4 weeks)
- Alarm scheduled with weekly recurrence
- `repeatMethod` in DB is `'rollingWindow'`
- `repeatOption` in DB is `'weekly'`
- `notificationTrigger.type` is `'DATE_WINDOW'`
- Alert shown: "Weekly Notification" with message about using app once a month
- 4 rows in `repeatNotificationInstance` table

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

### Test Case 1.8: Monthly repeat - far-term start (uses rolling window)
**Objective:** Verify monthly repeat with start date >= 1 month uses rolling window

**Steps:**
1. Open schedule form
2. Set date/time to 6 weeks from now
3. Set repeat option to "Repeat every month"
4. Turn alarm switch ON
5. Enter message: "Test monthly rolling window"
6. Tap "Schedule Notification"

**Expected Results:**
- 4 DATE notification instances scheduled (4 months)
- Alarm scheduled with monthly recurrence
- `repeatMethod` in DB is `'rollingWindow'`
- `repeatOption` in DB is `'monthly'`
- `notificationTrigger.type` is `'DATE_WINDOW'`
- Alert shown: "Monthly Notification" with message about using app once a month
- 4 rows in `repeatNotificationInstance` table
- Day-of-month clamping works correctly (e.g., Jan 31 -> Feb 28/29)

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

### Test Case 1.10: Yearly repeat - far-term start (uses rolling window)
**Objective:** Verify yearly repeat with start date >= 1 year uses rolling window

**Steps:**
1. Open schedule form
2. Set date/time to 18 months from now
3. Set repeat option to "Repeat every year"
4. Turn alarm switch ON
5. Enter message: "Test yearly rolling window"
6. Tap "Schedule Notification"

**Expected Results:**
- 2 DATE notification instances scheduled (2 years)
- Alarm scheduled with yearly recurrence
- `repeatMethod` in DB is `'rollingWindow'`
- `repeatOption` in DB is `'yearly'`
- `notificationTrigger.type` is `'DATE_WINDOW'`
- Alert shown: "Yearly Notification" with message about using app once a year
- 2 rows in `repeatNotificationInstance` table
- Day-of-month clamping works correctly (e.g., Feb 29 -> Feb 28 in non-leap years)

---

### Test Case 1.11: Daily repeat without alarm
**Objective:** Verify daily repeat scheduling without alarm

**Steps:**
1. Open schedule form
2. Set date/time to 2 days from now
3. Set repeat option to "Repeat every day"
4. Leave alarm switch OFF
5. Enter message: "Test daily no alarm"
6. Tap "Schedule Notification"

**Expected Results:**
- 14 DATE notification instances scheduled
- No alarms scheduled
- `hasAlarm` in DB is `0` or `false`
- Alert shown: "Daily Notification"

---

### Test Case 1.12: Monthly repeat with day 31 (clamping test)
**Objective:** Verify monthly repeat handles day 31 correctly when target month doesn't have 31 days

**Steps:**
1. Open schedule form
2. Set date/time to January 31, next year
3. Set repeat option to "Repeat every month"
4. Enter message: "Test monthly day 31"
5. Tap "Schedule Notification"

**Expected Results:**
- Rolling window instances scheduled correctly
- February instance uses Feb 28/29 (last valid day)
- March instance uses March 31
- April instance uses April 30 (last valid day)
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

