# Fix Android Replenisher Creating Extra Alarms

## Root Cause Analysis

### Problem 1: 4 Alarms Instead of 3 (Replenisher Issue)

**Scenario**:
1. User schedules daily alarm to start in 2 minutes
2. `scheduleDailyAlarmWindow` creates 3 alarms:
   - Alarm 1: T+2min
   - Alarm 2: T+2min + 1 day
   - Alarm 3: T+2min + 2 days

3. User closes app, reopens it ~1.5 minutes later
4. Replenisher runs:
   - `now = T+1.5min`
   - `oneMinuteFromNow = T+2.5min`
   - `getActiveFutureDailyAlarmInstances` filters: `fireDateTime > T+2.5min`
   - Alarm 1 (T+2min) is **filtered out** (not > T+2.5min)
   - Returns only Alarm 2 and Alarm 3 (2 alarms)
   - `activeInstances.length (2) < windowSize (3)` → schedules 1 more
   - `baseDate = latestInstance.fireDateTime + 1 day = (T+2min+2days) + 1 day = T+2min+3days`
   - Schedules Alarm 4: T+2min+3days
   - **Result: 4 alarms** (Alarm 1 still in DB as active, just filtered out)

5. After Alarm 1 fires, it gets marked inactive
6. Replenisher runs again, sees 2 alarms, but now Alarm 1 is gone
7. Correctly maintains 3 alarms

**Root Cause**: The replenisher uses `getActiveFutureDailyAlarmInstances` which filters out alarms less than 1 minute away. But those alarms are still in the database as `isActive=1`. When calculating how many alarms to schedule, it doesn't account for alarms that are filtered out but still active.

**The fix**: When calculating `baseDate`, we should use the **actual latest alarm date** (including filtered ones), not just the latest from the filtered query.

### Problem 2: Missing Manual Alarms in Debug Screen

**From logs**:
- Database has 2 alarms with `hasAlarm=true`
- Native has 4 alarms
- The 2 database alarms are NOT in native
- The 4 native alarms are NOT in database

**Root Cause**: The debug screen checks `dailyAlarmInstance` table for alarm IDs, but there's a mismatch. The issue is that:
1. Manual alarms might be getting cancelled/deleted incorrectly
2. Or the alarm IDs stored in `dailyAlarmInstance` don't match the actual native alarm IDs
3. The debug screen needs to better match alarms by checking both `alarmId` and `category` (Android)

**The fix**: Ensure alarm IDs are correctly stored and matched. The debug screen already checks `dailyAlarmInstance`, but we need to ensure alarms aren't being cancelled incorrectly.

### Problem 3: Extra Alarm Without Calendar Icon

**Root Cause**: When the replenisher runs, it calls `scheduleDailyAlarmWindow` with minimal config (line 2628-2635). It only passes `notification.message`, `notification.note`, `notification.link`, but **NOT** `calendarId` or `originalEventId`. The debug screen checks for calendar icon based on `alarm.config?.data?.calendarId` or `alarm.config?.data?.originalEventId`, but the replenisher doesn't pass these.

**The fix**: When replenishing calendar event alarms, pass `calendarId` and `originalEventId` in the alarm config data.

### Problem 4: Samsung Calendar Link Not Working

**Root Cause**: The link uses `content://com.android.calendar/events/` which is Google Calendar specific. Different Android manufacturers use different calendar apps (Samsung Calendar, Google Calendar, etc.) with different URI schemes.

**The fix**: Use a generic, standard Android approach that works with any calendar app that implements the Android CalendarContract API. Try multiple standard URI schemes in order, then fallback to Expo Calendar API.

## Solution

### 1. Fix Daily Alarm Replenisher BaseDate Calculation

**File**: [`utils/database.ts`](utils/database.ts)

**In `ensureDailyAlarmWindowForAllNotificationsInternal`** (line 2614-2621):

**Current logic**:
```typescript
let baseDate = new Date(notification.scheduleDateTime);
if (activeInstances.length > 0) {
  const latestInstance = activeInstances[activeInstances.length - 1];
  baseDate = new Date(latestInstance.fireDateTime);
  baseDate.setDate(baseDate.getDate() + 1);
}
```

**Problem**: `activeInstances` is filtered (excludes alarms < 1 minute away), so `latestInstance` might not be the actual latest.

**Fix**: Use `getAllActiveDailyAlarmInstances` to get ALL active instances (not filtered), then find the latest one:

```typescript
let baseDate = new Date(notification.scheduleDateTime);
// Get ALL active instances (not filtered by time) to find the true latest
const allActiveInstances = await getAllActiveDailyAlarmInstances(notification.notificationId);
if (allActiveInstances.length > 0) {
  // Find the latest fireDateTime (allActiveInstances is already sorted ASC)
  const latestInstance = allActiveInstances[allActiveInstances.length - 1];
  baseDate = new Date(latestInstance.fireDateTime);
  baseDate.setDate(baseDate.getDate() + 1); // Start from next day
}
```

### 2. Fix Weekly Alarm Replenisher BaseDate Calculation

**File**: [`utils/database.ts`](utils/database.ts)

**In `ensureRollingWindowNotificationInstances`** (line 2359-2381):

**Same issue**: Uses filtered `activeInstances` to calculate `baseDate`. Should use `getAllActiveRepeatNotificationInstances` instead.

**Fix**: Similar to daily alarms, use all active instances to find the true latest date.

### 3. Pass Calendar Event Data in Replenisher

**File**: [`utils/database.ts`](utils/database.ts)

**In `ensureDailyAlarmWindowForAllNotificationsInternal`** (line 2623-2638):

**Current**: Only passes `notification.message`, `note`, `link` in alarm config data.

**Fix**: Also pass `calendarId` and `originalEventId` if they exist:

```typescript
await scheduleDailyAlarmWindow(
  notification.notificationId,
  baseDate,
  { hour, minute },
  {
    title: notification.message || 'Daily Alarm',
    color: '#8ddaff',
    data: {
      notificationId: notification.notificationId,
      note: notification.note || '',
      link: notification.link || '',
      // Pass calendar event data if this is a calendar event
      ...(notification.calendarId ? { calendarId: notification.calendarId } : {}),
      ...(notification.originalEventId ? { originalEventId: notification.originalEventId } : {}),
    },
  },
  needed
);
```

### 4. Fix Android Calendar Link (Generic Solution)

**File**: [`utils/open-link.ts`](utils/open-link.ts)

**Current**: Uses `content://com.android.calendar/events/` which is Google Calendar specific.

**Fix**: Use a generic approach that works with any Android calendar app:

1. **Try generic calendar provider URI first**: `content://calendar/events/{eventId}` - This is the standard Android CalendarContract URI that should work with any calendar app implementing the standard API
2. **Try Google Calendar URI**: `content://com.android.calendar/events/{eventId}` - Fallback for Google Calendar
3. **Use Expo Calendar API as final fallback**: If URI schemes fail, use `Calendar.getEventsAsync` to retrieve the event and show details in an alert

**Implementation**:
```typescript
// Android: Try generic calendar provider URI first (works with any calendar app)
// Then fallback to Google Calendar URI, then use Expo Calendar API
let calendarUrl: string | null = null;
let opened = false;

if (Platform.OS === 'android') {
  // Try generic calendar provider URI first (standard Android CalendarContract)
  const genericCalendarUrl = `content://calendar/events/${encodeURIComponent(eventId)}`;
  const canOpenGeneric = await Linking.canOpenURL(genericCalendarUrl);
  
  if (canOpenGeneric) {
    try {
      await Linking.openURL(genericCalendarUrl);
      opened = true;
    } catch (error) {
      logger.warn(makeLogHeader(LOG_FILE, 'openNotifierLink'), 'Failed to open generic calendar URI, trying Google Calendar:', error);
    }
  }
  
  // If generic URI failed, try Google Calendar URI as fallback
  if (!opened) {
    const googleCalendarUrl = `content://com.android.calendar/events/${encodeURIComponent(eventId)}`;
    const canOpenGoogle = await Linking.canOpenURL(googleCalendarUrl);
    
    if (canOpenGoogle) {
      try {
        await Linking.openURL(googleCalendarUrl);
        opened = true;
      } catch (error) {
        logger.warn(makeLogHeader(LOG_FILE, 'openNotifierLink'), 'Failed to open Google Calendar URI:', error);
      }
    }
  }
  
  // If both URI schemes failed, fallback to Expo Calendar API
  if (!opened) {
    // Use existing fallback logic with Expo Calendar API
    // ... existing fallback code ...
  }
}
```

**Note**: The generic `content://calendar/events/` URI uses the standard Android CalendarContract API which is supported by all calendar apps that implement the Android calendar provider interface. This includes Google Calendar, Samsung Calendar, and most other calendar apps.

### 5. Verify MAX Check for Weekly Alarms

**File**: [`components/scheduleForm.tsx`](components/scheduleForm.tsx)

**In `checkNotificationLimit`** (line 350):

**Current**: Only accounts for daily alarms with rolling window size.

**Fix**: Also account for weekly alarms:

```typescript
// Check if current form state indicates a daily/weekly alarm with alarm enabled
const isDailyAlarm = repeatOption === 'daily' && scheduleAlarm;
const isWeeklyAlarm = repeatOption === 'weekly' && scheduleAlarm;
let rollingWindowSize = 1;
if (isDailyAlarm) {
  rollingWindowSize = getDailyRollingWindowSize();
} else if (isWeeklyAlarm) {
  rollingWindowSize = getWeeklyRollingWindowSize();
}
```

**Import**: `import { getDailyRollingWindowSize, getWeeklyRollingWindowSize } from '@/utils/rolling-window-config';`

### 6. Debug Screen: Better Alarm Matching

**File**: [`app/debug/native-alarms.tsx`](app/debug/native-alarms.tsx)

**Current**: Already checks `dailyAlarmInstance` table (lines 107-116), but there might be an issue with how alarms are matched.

**Fix**: Ensure the debug screen properly matches alarms by:
1. Checking `alarmId` from `dailyAlarmInstance` table
2. Checking `category` (Android) matches `notificationId`
3. Checking `config.data.notificationId` matches parent notification

The current implementation already does this, so the issue might be that alarms are being cancelled incorrectly. We should verify that alarms aren't being marked inactive when they shouldn't be.

## Implementation Details

### Change 1: Fix Daily Alarm Replenisher

**Location**: `utils/database.ts`, line ~2614

Replace the baseDate calculation logic to use `getAllActiveDailyAlarmInstances` instead of filtered `activeInstances`.

### Change 2: Fix Weekly Alarm Replenisher

**Location**: `utils/database.ts`, line ~2359

Replace the baseDate calculation logic to use `getAllActiveRepeatNotificationInstances` instead of filtered `activeInstances`.

### Change 3: Pass Calendar Data in Replenisher

**Location**: `utils/database.ts`, line ~2623

Update `scheduleDailyAlarmWindow` call to include `calendarId` and `originalEventId` in alarm config data.

### Change 4: Fix Android Calendar Link (Generic Solution)

**Location**: `utils/open-link.ts`, line ~38

Update Android calendar link logic to:
1. Try generic `content://calendar/events/` URI first (standard CalendarContract API)
2. Fallback to Google Calendar URI if generic fails
3. Use Expo Calendar API as final fallback

### Change 5: Update MAX Check for Weekly

**Location**: `components/scheduleForm.tsx`, line ~350

Update `checkNotificationLimit` to account for weekly rolling window size.

## Files to Modify

1. [`utils/database.ts`](utils/database.ts) - Fix baseDate calculation in both daily and weekly replenishers, pass calendar data
2. [`components/scheduleForm.tsx`](components/scheduleForm.tsx) - Update MAX check to account for weekly rolling window
3. [`utils/open-link.ts`](utils/open-link.ts) - Fix Android calendar link with generic solution

## Testing Checklist

- [ ] Schedule daily alarm, close app, reopen before first alarm fires - should still show 3 alarms (not 4)
- [ ] Schedule daily alarm, let first alarm fire, close app, reopen - should show 3 alarms
- [ ] Schedule weekly alarm, close app, reopen - should show correct rolling window size (not extra)
- [ ] Schedule calendar event daily alarm, close app, reopen - replenished alarms should have calendar icon
- [ ] Calendar event link should work on any Android calendar app (Samsung, Google, etc.)
- [ ] MAX check should account for weekly rolling window size
- [ ] Manual alarms should appear correctly in debug screen