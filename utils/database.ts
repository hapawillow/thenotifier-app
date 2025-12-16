import * as Notifications from 'expo-notifications';
import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';

// Open the database
async function openDatabase() {
  const db = await SQLite.openDatabaseAsync("thenotifier.db");
  return db;
}

let db;
let isInitialized = false;

(async () => {
  db = await openDatabase();
})();

// Initialize database and create tables if they don't exist
export const initDatabase = async () => {
  if (isInitialized) {
    return; // Already initialized, skip
  }

  try {
    const db = await openDatabase();

    // Create scheduledNotification table if it doesn't exist
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS scheduledNotification (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        notificationId TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        note TEXT DEFAULT NULL,
        link TEXT DEFAULT NULL,
        scheduleDateTime TEXT NOT NULL,
        scheduleDateTimeLocal TEXT NOT NULL,
        repeatOption TEXT DEFAULT NULL,
        notificationTrigger TEXT DEFAULT NULL,
        hasAlarm INTEGER DEFAULT 0,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add new columns if they don't exist (migration for existing databases)
    try {
      await db.execAsync(`ALTER TABLE scheduledNotification ADD COLUMN repeatOption TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        console.log('Note: repeatOption column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE scheduledNotification ADD COLUMN notificationTrigger TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        console.log('Note: notificationTrigger column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE scheduledNotification ADD COLUMN hasAlarm INTEGER DEFAULT 0;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        console.log('Note: hasAlarm column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE scheduledNotification ADD COLUMN calendarId TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        console.log('Note: calendarId column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE scheduledNotification ADD COLUMN originalEventId TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        console.log('Note: originalEventId column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE scheduledNotification ADD COLUMN location TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        console.log('Note: location column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE scheduledNotification ADD COLUMN originalEventTitle TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        console.log('Note: originalEventTitle column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE scheduledNotification ADD COLUMN originalEventStartDate TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        console.log('Note: originalEventStartDate column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE scheduledNotification ADD COLUMN originalEventEndDate TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        console.log('Note: originalEventEndDate column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE scheduledNotification ADD COLUMN originalEventLocation TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        console.log('Note: originalEventLocation column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE scheduledNotification ADD COLUMN originalEventRecurring TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        console.log('Note: originalEventRecurring column may already exist');
      }
    }

    // Create indexes for scheduledNotification table
    await db.execAsync(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduledNotification_notificationId ON scheduledNotification (notificationId);
    `);

    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_scheduledNotification_scheduleDateTime ON scheduledNotification (scheduleDateTime);
    `);

    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_scheduledNotification_calendar_event ON scheduledNotification (calendarId, originalEventId);
    `);

    // Create archivedNotification table if it doesn't exist
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS archivedNotification (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        notificationId TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        note TEXT DEFAULT NULL,
        link TEXT DEFAULT NULL,
        scheduleDateTime TEXT NOT NULL,
        scheduleDateTimeLocal TEXT NOT NULL,
        repeatOption TEXT DEFAULT NULL,
        notificationTrigger TEXT DEFAULT NULL,
        hasAlarm INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        handledAt TEXT DEFAULT NULL,
        cancelledAt TEXT DEFAULT NULL,
        archivedAt TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add new columns if they don't exist (migration for existing databases)
    try {
      await db.execAsync(`ALTER TABLE archivedNotification ADD COLUMN repeatOption TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        console.log('Note: repeatOption column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE archivedNotification ADD COLUMN notificationTrigger TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        console.log('Note: notificationTrigger column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE archivedNotification ADD COLUMN hasAlarm INTEGER DEFAULT 0;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        console.log('Note: hasAlarm column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE archivedNotification ADD COLUMN calendarId TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        console.log('Note: calendarId column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE archivedNotification ADD COLUMN originalEventId TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        console.log('Note: originalEventId column may already exist');
      }
    }

    // Create indexes for archivedNotification table
    await db.execAsync(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_archivedNotification_notificationId ON archivedNotification (notificationId);
    `);

    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_archivedNotification_scheduleDateTime ON archivedNotification (scheduleDateTime);
    `);

    // Create calendarSelection table if it doesn't exist
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS calendarSelection (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        calendarId TEXT NOT NULL UNIQUE,
        isSelected INTEGER NOT NULL DEFAULT 1,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create index for calendarSelection table
    await db.execAsync(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_calendarSelection_calendarId ON calendarSelection (calendarId);
    `);

    // Create appPreferences table if it doesn't exist (for storing app-level preferences like alarm permission denial state)
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS appPreferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create index for appPreferences table
    await db.execAsync(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_appPreferences_key ON appPreferences (key);
    `);

    // Create ignoredCalendarEvents table if it doesn't exist (for storing ignored calendar events)
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS ignoredCalendarEvents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        calendarId TEXT NOT NULL,
        originalEventId TEXT NOT NULL,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(calendarId, originalEventId)
      );
    `);

    // Create index for ignoredCalendarEvents table
    await db.execAsync(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ignoredCalendarEvents_composite ON ignoredCalendarEvents (calendarId, originalEventId);
    `);

    // Create dailyAlarmInstance table if it doesn't exist (for tracking AlarmKit alarms for daily repeating notifications)
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS dailyAlarmInstance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        notificationId TEXT NOT NULL,
        alarmId TEXT NOT NULL,
        fireDateTime TEXT NOT NULL,
        isActive INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
        cancelledAt TEXT DEFAULT NULL,
        UNIQUE(notificationId, fireDateTime)
      );
    `);

    // Create indexes for dailyAlarmInstance table
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_dailyAlarmInstance_notificationId_isActive ON dailyAlarmInstance (notificationId, isActive);
    `);

    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_dailyAlarmInstance_fireDateTime ON dailyAlarmInstance (fireDateTime);
    `);

    isInitialized = true;
    console.log('Database initialized successfully');
  } catch (error: any) {
    console.error('Database initialization failed:', error);
    throw new Error(`Database initialization failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Save scheduled notification data
export const saveScheduledNotificationData = async (
  notificationId: string,
  title: string,
  message: string,
  note: string,
  link: string,
  scheduleDateTime: string,
  scheduleDateTimeLocal: string,
  repeatOption?: string,
  notificationTrigger?: Notifications.NotificationTriggerInput,
  hasAlarm?: boolean,
  calendarId?: string,
  originalEventId?: string,
  location?: string,
  originalEventTitle?: string,
  originalEventStartDate?: string,
  originalEventEndDate?: string,
  originalEventLocation?: string,
  originalEventRecurring?: string
) => {
  console.log('Saving scheduled notification data:', { notificationId, title, message, note, link, scheduleDateTime, scheduleDateTimeLocal, repeatOption, notificationTrigger });
  try {
    const db = await openDatabase();
    // First ensure table exists
    await initDatabase();

    // Serialize notificationTrigger to JSON string if provided
    const notificationTriggerJson = notificationTrigger ? JSON.stringify(notificationTrigger) : null;
    const repeatOptionValue = repeatOption || null;
    const hasAlarmValue = hasAlarm ? 1 : 0;

    // Escape single quotes in string values to prevent SQL injection
    const escapeSql = (str: string) => str.replace(/'/g, "''");
    const notificationTriggerSql = notificationTriggerJson ? `'${escapeSql(notificationTriggerJson)}'` : 'NULL';
    const repeatOptionSql = repeatOptionValue ? `'${escapeSql(repeatOptionValue)}'` : 'NULL';
    const calendarIdSql = calendarId ? `'${escapeSql(calendarId)}'` : 'NULL';
    const originalEventIdSql = originalEventId ? `'${escapeSql(originalEventId)}'` : 'NULL';
    const locationSql = location ? `'${escapeSql(location)}'` : 'NULL';
    const originalEventTitleSql = originalEventTitle ? `'${escapeSql(originalEventTitle)}'` : 'NULL';
    const originalEventStartDateSql = originalEventStartDate ? `'${escapeSql(originalEventStartDate)}'` : 'NULL';
    const originalEventEndDateSql = originalEventEndDate ? `'${escapeSql(originalEventEndDate)}'` : 'NULL';
    const originalEventLocationSql = originalEventLocation ? `'${escapeSql(originalEventLocation)}'` : 'NULL';
    const originalEventRecurringSql = originalEventRecurring ? `'${escapeSql(originalEventRecurring)}'` : 'NULL';

    // Use INSERT OR REPLACE to either insert new or update existing notification
    await db.execAsync(
      `INSERT OR REPLACE INTO scheduledNotification (notificationId, title, message, note, link, scheduleDateTime, scheduleDateTimeLocal, repeatOption, notificationTrigger, hasAlarm, calendarId, originalEventId, location, originalEventTitle, originalEventStartDate, originalEventEndDate, originalEventLocation, originalEventRecurring, updatedAt)
      VALUES ('${escapeSql(notificationId)}', '${escapeSql(title)}', '${escapeSql(message)}', '${escapeSql(note)}', '${escapeSql(link)}', '${scheduleDateTime}', '${escapeSql(scheduleDateTimeLocal)}', ${repeatOptionSql}, ${notificationTriggerSql}, ${hasAlarmValue}, ${calendarIdSql}, ${originalEventIdSql}, ${locationSql}, ${originalEventTitleSql}, ${originalEventStartDateSql}, ${originalEventEndDateSql}, ${originalEventLocationSql}, ${originalEventRecurringSql}, CURRENT_TIMESTAMP);`
    );
    console.log('Notification data saved successfully');
    const result = await getScheduledNotificationData(notificationId);
    console.log('Saved scheduled notification data:', result);
  } catch (error: any) {
    throw new Error(`Failed to save scheduled notification data: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Get scheduled notification data
export const getScheduledNotificationData = async (notificationId: string) => {
  try {
    const db = await openDatabase();
    // First ensure table exists
    await initDatabase();
    const result = await db.getFirstAsync<{ notificationId: string; title: string; message: string; note: string; link: string; scheduleDateTime: string; scheduleDateTimeLocal: string; repeatOption: string | null; notificationTrigger: string | null; hasAlarm: number; calendarId: string | null; originalEventId: string | null; createdAt: string; updatedAt: string }>(
      `SELECT notificationId, title, message, note, link, scheduleDateTime, scheduleDateTimeLocal, repeatOption, notificationTrigger, hasAlarm, calendarId, originalEventId, createdAt, updatedAt FROM scheduledNotification WHERE notificationId = '${notificationId.replace(/'/g, "''")}';`
    );
    if (!result) return null;

    // Parse notificationTrigger JSON if it exists
    let parsedTrigger: Notifications.NotificationTriggerInput | undefined;
    if (result.notificationTrigger) {
      try {
        parsedTrigger = JSON.parse(result.notificationTrigger) as Notifications.NotificationTriggerInput;
      } catch (e) {
        console.error('Failed to parse notificationTrigger JSON:', e);
      }
    }

    return {
      ...result,
      notificationTrigger: parsedTrigger,
    };
  } catch (error: any) {
    console.error('Failed to get scheduled notification data:', error);
    return null;
  }
};

// Get all scheduled notification data
export const getAllScheduledNotificationData = async () => {
  try {
    const db = await openDatabase();
    // First ensure table exists
    await initDatabase();
    const result = await db.getAllAsync<{ id: number; notificationId: string; title: string; message: string; note: string; link: string; scheduleDateTime: string; scheduleDateTimeLocal: string; repeatOption: string | null; notificationTrigger: string | null; hasAlarm: number; calendarId: string | null; originalEventId: string | null; createdAt: string; updatedAt: string }>(
      `SELECT id, notificationId, title, message, note, link, scheduleDateTime, scheduleDateTimeLocal, repeatOption, notificationTrigger, hasAlarm, calendarId, originalEventId, createdAt, updatedAt FROM scheduledNotification ORDER BY scheduleDateTime ASC;`
    );
    if (!result) return [];

    // Parse notificationTrigger JSON for each result
    return result.map(item => {
      let parsedTrigger: Notifications.NotificationTriggerInput | undefined;
      if (item.notificationTrigger) {
        try {
          parsedTrigger = JSON.parse(item.notificationTrigger) as Notifications.NotificationTriggerInput;
        } catch (e) {
          console.error('Failed to parse notificationTrigger JSON:', e);
        }
      }
      return {
        ...item,
        notificationTrigger: parsedTrigger,
        hasAlarm: item.hasAlarm === 1,
      };
    });
  } catch (error: any) {
    console.error('Failed to get all scheduled notification data:', error);
    return [];
  }
};

// Get scheduled notification count
export const getScheduledNotificationCount = async () => {
  try {
    const db = await openDatabase();
    // First ensure table exists
    await initDatabase();
    const result = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM scheduledNotification;`
    );
    return result || [];
  } catch (error: any) {
    console.error('Failed to get all scheduled notification data:', error);
    return [];
  }
};

// Get all upcoming calendar notifications
export const getUpcomingCalendarNotifications = async () => {
  try {
    const db = await openDatabase();
    await initDatabase();

    // Get current time in ISO format for comparison
    const now = new Date().toISOString();

    // Query for notifications with calendar events that are upcoming
    const result = await db.getAllAsync<{ id: number; notificationId: string; title: string; message: string; note: string; link: string; scheduleDateTime: string; scheduleDateTimeLocal: string; repeatOption: string | null; notificationTrigger: string | null; hasAlarm: number; calendarId: string | null; originalEventId: string | null; location: string | null; originalEventTitle: string | null; originalEventStartDate: string | null; originalEventEndDate: string | null; originalEventLocation: string | null; originalEventRecurring: string | null; createdAt: string; updatedAt: string }>(
      `SELECT id, notificationId, title, message, note, link, scheduleDateTime, scheduleDateTimeLocal, repeatOption, notificationTrigger, hasAlarm, calendarId, originalEventId, location, originalEventTitle, originalEventStartDate, originalEventEndDate, originalEventLocation, originalEventRecurring, createdAt, updatedAt FROM scheduledNotification WHERE calendarId IS NOT NULL AND originalEventId IS NOT NULL AND scheduleDateTime > '${now}' ORDER BY scheduleDateTime ASC;`
    );

    if (!result) return [];

    // Parse notificationTrigger JSON for each result
    return result.map(item => {
      let parsedTrigger: Notifications.NotificationTriggerInput | undefined;
      if (item.notificationTrigger) {
        try {
          parsedTrigger = JSON.parse(item.notificationTrigger) as Notifications.NotificationTriggerInput;
        } catch (e) {
          console.error('Failed to parse notificationTrigger JSON:', e);
        }
      }
      return {
        ...item,
        notificationTrigger: parsedTrigger,
        hasAlarm: item.hasAlarm === 1,
      };
    });
  } catch (error: any) {
    console.error('Failed to get upcoming calendar notifications:', error);
    return [];
  }
};

// Delete scheduled notification
export const deleteScheduledNotification = async (notificationId: string) => {
  try {
    const db = await openDatabase();
    await initDatabase();
    await db.execAsync(`DELETE FROM scheduledNotification WHERE notificationId = '${notificationId}';`);
    console.log('Scheduled notification deleted successfully');
  } catch (error: any) {
    console.error('Failed to delete scheduled notification:', error);
    throw new Error(`Failed to delete scheduled notification: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Update scheduled notification data
export const updateScheduledNotificationData = async (
  notificationId: string,
  title: string,
  message: string,
  note: string,
  link: string,
  scheduleDateTime: string,
  scheduleDateTimeLocal: string,
  repeatOption?: string,
  notificationTrigger?: Notifications.NotificationTriggerInput,
  hasAlarm?: boolean
) => {
  try {
    const db = await openDatabase();
    await initDatabase();

    // Serialize notificationTrigger to JSON string if provided
    const notificationTriggerJson = notificationTrigger ? JSON.stringify(notificationTrigger) : null;
    const repeatOptionValue = repeatOption || null;
    const hasAlarmValue = hasAlarm ? 1 : 0;

    // Escape single quotes in string values to prevent SQL injection
    const escapeSql = (str: string) => str.replace(/'/g, "''");
    const notificationTriggerSql = notificationTriggerJson ? `'${escapeSql(notificationTriggerJson)}'` : 'NULL';
    const repeatOptionSql = repeatOptionValue ? `'${escapeSql(repeatOptionValue)}'` : 'NULL';

    await db.execAsync(
      `UPDATE scheduledNotification 
       SET title = '${escapeSql(title)}', 
           message = '${escapeSql(message)}', 
           note = '${escapeSql(note)}', 
           link = '${escapeSql(link)}', 
           scheduleDateTime = '${scheduleDateTime}', 
           scheduleDateTimeLocal = '${escapeSql(scheduleDateTimeLocal)}',
           repeatOption = ${repeatOptionSql},
           notificationTrigger = ${notificationTriggerSql},
           hasAlarm = ${hasAlarmValue},
           updatedAt = CURRENT_TIMESTAMP
       WHERE notificationId = '${escapeSql(notificationId)}';`
    );
    console.log('Scheduled notification data updated successfully');
  } catch (error: any) {
    console.error('Failed to update scheduled notification data:', error);
    throw new Error(`Failed to update scheduled notification data: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Archive scheduled notification data
export const archiveScheduledNotifications = async () => {
  try {
    const db = await openDatabase();
    await initDatabase();
    // Get current time in ISO format for comparison
    const now = new Date().toISOString();

    // const debug_allScheduledNotificationData = await getAllScheduledNotificationData();
    // console.log('Debug all scheduled notification data:', debug_allScheduledNotificationData);

    // Archive notifications that have passed (scheduleDateTime < now)
    await db.execAsync(`INSERT OR REPLACE INTO archivedNotification (notificationId, title, message, note, link, scheduleDateTime, scheduleDateTimeLocal, repeatOption, notificationTrigger, hasAlarm, calendarId, originalEventId, createdAt, updatedAt) 
      SELECT
        notificationId,
        title,
        message,
        note,
        link,
        scheduleDateTime,
        scheduleDateTimeLocal,
        repeatOption,
        notificationTrigger,
        hasAlarm,
        calendarId,
        originalEventId,
        createdAt,
        updatedAt
      FROM scheduledNotification
      WHERE scheduleDateTime < '${now}'
      and (repeatOption IS NULL OR repeatOption = 'none');`);
    console.log('Archived scheduled notification data successfully');

    // Delete past notifications from scheduled table
    await db.execAsync(
      `DELETE FROM scheduledNotification 
      WHERE scheduleDateTime < '${now}' 
      and (repeatOption IS NULL OR repeatOption = 'none');`);
    console.log('Deleted scheduled notification data successfully');
  } catch (error: any) {
    console.error('Failed to archive scheduled notification data:', error);
    throw new Error(`Failed to archive scheduled notification data: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Update archived notification data
export const updateArchivedNotificationData = async (notificationId: string) => {
  try {
    const db = await openDatabase();
    await initDatabase();

    await db.execAsync(`UPDATE archivedNotification SET handledAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP WHERE notificationId = '${notificationId}';`);
    console.log('Archived notification data updated successfully');
  } catch (error: any) {
    console.error('Failed to update archived notification data:', error);
    throw new Error(`Failed to update archived notification data: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Get all archived notification data
export const getAllArchivedNotificationData = async () => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const result = await db.getAllAsync<{ id: number; notificationId: string; title: string; message: string; note: string; link: string; scheduleDateTime: string; scheduleDateTimeLocal: string; repeatOption: string | null; notificationTrigger: string | null; hasAlarm: number; calendarId: string | null; originalEventId: string | null; createdAt: string; updatedAt: string; handledAt: string | null; cancelledAt: string | null; archivedAt: string }>(
      `SELECT id, notificationId, title, message, note, link, scheduleDateTime, scheduleDateTimeLocal, repeatOption, notificationTrigger, hasAlarm, calendarId, originalEventId, createdAt, updatedAt, handledAt, cancelledAt, archivedAt FROM archivedNotification ORDER BY archivedAt DESC;`
    );
    if (!result) return [];

    // Parse notificationTrigger JSON for each result
    return result.map(item => {
      let parsedTrigger: Notifications.NotificationTriggerInput | undefined;
      if (item.notificationTrigger) {
        try {
          parsedTrigger = JSON.parse(item.notificationTrigger) as Notifications.NotificationTriggerInput;
        } catch (e) {
          console.error('Failed to parse notificationTrigger JSON:', e);
        }
      }
      return {
        ...item,
        notificationTrigger: parsedTrigger,
        hasAlarm: item.hasAlarm === 1,
      };
    });
  } catch (error: any) {
    console.error('Failed to get all archived notification data:', error);
    return [];
  }
};

// Get archived notification data
export const getArchivedNotificationData = async (notificationId: string) => {
  try {
    const db = await openDatabase();
    await initDatabase();
    // console.log('Getting archived notification data for notificationId:', notificationId);
    const result = await db.getFirstAsync<{ notificationId: string; title: string; message: string; note: string; link: string; scheduleDateTime: string; scheduleDateTimeLocal: string; repeatOption: string | null; notificationTrigger: string | null; hasAlarm: number; createdAt: string; updatedAt: string; handledAt: string | null; cancelledAt: string | null; archivedAt: string }>(
      `SELECT * FROM archivedNotification WHERE notificationId = '${notificationId.replace(/'/g, "''")}';`
    );
    if (!result) return null;

    // Parse notificationTrigger JSON if it exists
    let parsedTrigger: Notifications.NotificationTriggerInput | undefined;
    if (result.notificationTrigger) {
      try {
        parsedTrigger = JSON.parse(result.notificationTrigger) as Notifications.NotificationTriggerInput;
      } catch (e) {
        console.error('Failed to parse notificationTrigger JSON:', e);
      }
    }

    console.log('Archived notification data:', result);
    return {
      ...result,
      notificationTrigger: parsedTrigger,
      hasAlarm: result.hasAlarm === 1,
    };
  } catch (error: any) {
    console.error('Failed to get archived notification data:', error);
    return null;
  }
};

// Save calendar selection state
export const saveCalendarSelection = async (calendarId: string, isSelected: boolean) => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const isSelectedInt = isSelected ? 1 : 0;
    await db.execAsync(
      `INSERT OR REPLACE INTO calendarSelection (calendarId, isSelected, updatedAt)
      VALUES ('${calendarId}', ${isSelectedInt}, CURRENT_TIMESTAMP);`
    );
    console.log(`Calendar selection saved: ${calendarId} = ${isSelected}`);
  } catch (error: any) {
    console.error('Failed to save calendar selection:', error);
    throw new Error(`Failed to save calendar selection: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Save multiple calendar selections at once
export const saveCalendarSelections = async (selectedCalendarIds: Set<string>) => {
  try {
    const db = await openDatabase();
    await initDatabase();

    // Start a transaction for better performance
    await db.execAsync('BEGIN TRANSACTION;');

    try {
      // Get all existing calendar IDs from the database
      const existingCalendars = await db.getAllAsync<{ calendarId: string }>(
        `SELECT calendarId FROM calendarSelection;`
      );
      const existingCalendarIds = new Set(existingCalendars.map(row => row.calendarId));

      // Update or insert selected calendars
      for (const calendarId of selectedCalendarIds) {
        await db.execAsync(
          `INSERT OR REPLACE INTO calendarSelection (calendarId, isSelected, updatedAt)
          VALUES ('${calendarId}', 1, CURRENT_TIMESTAMP);`
        );
      }

      // Update existing calendars that are now unselected
      for (const existingId of existingCalendarIds) {
        if (!selectedCalendarIds.has(existingId)) {
          await db.execAsync(
            `INSERT OR REPLACE INTO calendarSelection (calendarId, isSelected, updatedAt)
            VALUES ('${existingId}', 0, CURRENT_TIMESTAMP);`
          );
        }
      }

      await db.execAsync('COMMIT;');
      console.log('Calendar selections saved successfully');
    } catch (error) {
      await db.execAsync('ROLLBACK;');
      throw error;
    }
  } catch (error: any) {
    console.error('Failed to save calendar selections:', error);
    throw new Error(`Failed to save calendar selections: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Check if there are any upcoming scheduled notifications for a calendar event
export const checkUpcomingNotificationForCalendarEvent = async (calendarId: string, originalEventId: string): Promise<boolean> => {
  try {
    const db = await openDatabase();
    await initDatabase();

    // Get current time in ISO format for comparison
    const now = new Date().toISOString();

    // Escape single quotes to prevent SQL injection
    const escapeSql = (str: string) => str.replace(/'/g, "''");
    const escapedCalendarId = escapeSql(calendarId);
    const escapedOriginalEventId = escapeSql(originalEventId);

    // Query for upcoming notifications matching calendarId AND originalEventId
    const result = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM scheduledNotification 
       WHERE calendarId = '${escapedCalendarId}' 
       AND originalEventId = '${escapedOriginalEventId}' 
       AND scheduleDateTime > '${now}';`
    );

    return result ? result.count > 0 : false;
  } catch (error: any) {
    console.error('Failed to check upcoming notification for calendar event:', error);
    // Return false on error to allow user to proceed
    return false;
  }
};

// Save ignored calendar event
export const saveIgnoredCalendarEvent = async (calendarId: string, originalEventId: string): Promise<void> => {
  try {
    const db = await openDatabase();
    await initDatabase();

    // Escape single quotes to prevent SQL injection
    const escapeSql = (str: string) => str.replace(/'/g, "''");
    const escapedCalendarId = escapeSql(calendarId);
    const escapedOriginalEventId = escapeSql(originalEventId);

    await db.execAsync(`
      INSERT OR IGNORE INTO ignoredCalendarEvents (calendarId, originalEventId)
      VALUES ('${escapedCalendarId}', '${escapedOriginalEventId}');
    `);
  } catch (error: any) {
    console.error('Failed to save ignored calendar event:', error);
    throw error;
  }
};

// Check if a calendar event is ignored
export const isCalendarEventIgnored = async (calendarId: string, originalEventId: string): Promise<boolean> => {
  try {
    const db = await openDatabase();
    await initDatabase();

    // Escape single quotes to prevent SQL injection
    const escapeSql = (str: string) => str.replace(/'/g, "''");
    const escapedCalendarId = escapeSql(calendarId);
    const escapedOriginalEventId = escapeSql(originalEventId);

    const result = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM ignoredCalendarEvents 
       WHERE calendarId = '${escapedCalendarId}' 
       AND originalEventId = '${escapedOriginalEventId}';`
    );

    return result ? result.count > 0 : false;
  } catch (error: any) {
    console.error('Failed to check if calendar event is ignored:', error);
    // Return false on error to allow checking
    return false;
  }
};

// Get calendar selection state
export const getCalendarSelection = async (calendarId: string): Promise<boolean | null> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const result = await db.getFirstAsync<{ isSelected: number }>(
      `SELECT isSelected FROM calendarSelection WHERE calendarId = '${calendarId}';`
    );
    return result ? result.isSelected === 1 : null;
  } catch (error: any) {
    console.error('Failed to get calendar selection:', error);
    return null;
  }
};

// Get all calendar selection states
export const getAllCalendarSelections = async (): Promise<Map<string, boolean>> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const result = await db.getAllAsync<{ calendarId: string; isSelected: number }>(
      `SELECT calendarId, isSelected FROM calendarSelection;`
    );
    const selections = new Map<string, boolean>();
    for (const row of result) {
      selections.set(row.calendarId, row.isSelected === 1);
    }
    return selections;
  } catch (error: any) {
    console.error('Failed to get all calendar selections:', error);
    return new Map();
  }
};

// Get set of selected calendar IDs
export const getSelectedCalendarIds = async (): Promise<Set<string>> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const result = await db.getAllAsync<{ calendarId: string }>(
      `SELECT calendarId FROM calendarSelection WHERE isSelected = 1;`
    );
    return new Set(result.map(row => row.calendarId));
  } catch (error: any) {
    console.error('Failed to get selected calendar IDs:', error);
    return new Set();
  }
};

// Save alarm permission denied state
export const saveAlarmPermissionDenied = async (denied: boolean): Promise<void> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const escapeSql = (str: string) => str.replace(/'/g, "''");
    const value = denied ? 'true' : 'false';
    await db.execAsync(
      `INSERT OR REPLACE INTO appPreferences (key, value, updatedAt)
      VALUES ('alarmPermissionDenied', '${escapeSql(value)}', CURRENT_TIMESTAMP);`
    );
    console.log(`Alarm permission denied state saved: ${denied}`);
  } catch (error: any) {
    console.error('Failed to save alarm permission denied state:', error);
    throw new Error(`Failed to save alarm permission denied state: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Get alarm permission denied state
export const getAlarmPermissionDenied = async (): Promise<boolean> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const result = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM appPreferences WHERE key = 'alarmPermissionDenied';`
    );
    return result ? result.value === 'true' : false;
  } catch (error: any) {
    console.error('Failed to get alarm permission denied state:', error);
    return false;
  }
};

// Daily Alarm Instance CRUD operations

// Insert a daily alarm instance
export const insertDailyAlarmInstance = async (
  notificationId: string,
  alarmId: string,
  fireDateTime: string
): Promise<void> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const escapeSql = (str: string) => str.replace(/'/g, "''");
    await db.execAsync(
      `INSERT OR IGNORE INTO dailyAlarmInstance (notificationId, alarmId, fireDateTime, isActive, createdAt, updatedAt)
       VALUES ('${escapeSql(notificationId)}', '${escapeSql(alarmId)}', '${fireDateTime}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`
    );
  } catch (error: any) {
    console.error('Failed to insert daily alarm instance:', error);
    throw new Error(`Failed to insert daily alarm instance: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Get active future daily alarm instances for a notification
export const getActiveFutureDailyAlarmInstances = async (
  notificationId: string,
  nowIso: string
): Promise<Array<{ alarmId: string; fireDateTime: string }>> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const escapeSql = (str: string) => str.replace(/'/g, "''");
    const result = await db.getAllAsync<{ alarmId: string; fireDateTime: string }>(
      `SELECT alarmId, fireDateTime FROM dailyAlarmInstance 
       WHERE notificationId = '${escapeSql(notificationId)}' 
       AND isActive = 1 
       AND fireDateTime > '${nowIso}'
       ORDER BY fireDateTime ASC;`
    );
    return result || [];
  } catch (error: any) {
    console.error('Failed to get active future daily alarm instances:', error);
    return [];
  }
};

// Get all active daily alarm instances for a notification
export const getAllActiveDailyAlarmInstances = async (
  notificationId: string
): Promise<Array<{ alarmId: string; fireDateTime: string }>> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const escapeSql = (str: string) => str.replace(/'/g, "''");
    const result = await db.getAllAsync<{ alarmId: string; fireDateTime: string }>(
      `SELECT alarmId, fireDateTime FROM dailyAlarmInstance 
       WHERE notificationId = '${escapeSql(notificationId)}' 
       AND isActive = 1
       ORDER BY fireDateTime ASC;`
    );
    return result || [];
  } catch (error: any) {
    console.error('Failed to get all active daily alarm instances:', error);
    return [];
  }
};

// Mark a daily alarm instance as cancelled
export const markDailyAlarmInstanceCancelled = async (alarmId: string): Promise<void> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const escapeSql = (str: string) => str.replace(/'/g, "''");
    await db.execAsync(
      `UPDATE dailyAlarmInstance 
       SET isActive = 0, cancelledAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP 
       WHERE alarmId = '${escapeSql(alarmId)}';`
    );
  } catch (error: any) {
    console.error('Failed to mark daily alarm instance as cancelled:', error);
    throw new Error(`Failed to mark daily alarm instance as cancelled: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Mark all daily alarm instances for a notification as cancelled
export const markAllDailyAlarmInstancesCancelled = async (notificationId: string): Promise<void> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const escapeSql = (str: string) => str.replace(/'/g, "''");
    await db.execAsync(
      `UPDATE dailyAlarmInstance 
       SET isActive = 0, cancelledAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP 
       WHERE notificationId = '${escapeSql(notificationId)}' AND isActive = 1;`
    );
  } catch (error: any) {
    console.error('Failed to mark all daily alarm instances as cancelled:', error);
    throw new Error(`Failed to mark all daily alarm instances as cancelled: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Higher-level orchestrator: Schedule daily alarm window (14 fixed alarms)
// This should be called from scheduleForm.tsx when scheduling a daily alarm
export const scheduleDailyAlarmWindow = async (
  notificationId: string,
  baseDate: Date,
  time: { hour: number; minute: number },
  alarmConfig: { title: string; color?: string; data?: any; actions?: any[] },
  count: number = 14
): Promise<void> => {
  const { NativeAlarmManager } = await import('rn-native-alarmkit');
  
  const now = new Date();
  const oneMinuteFromNow = new Date(now.getTime() + 60 * 1000);
  
  // Calculate dates for the next 14 occurrences
  const dates: Date[] = [];
  let currentDate = new Date(baseDate);
  
  // Ensure we start from baseDate, but skip if it's in the past
  if (currentDate <= oneMinuteFromNow) {
    // Start from tomorrow if baseDate has passed
    currentDate = new Date(baseDate);
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  for (let i = 0; i < count; i++) {
    const alarmDate = new Date(currentDate);
    alarmDate.setHours(time.hour, time.minute, 0, 0);
    
    // Only schedule if it's at least 1 minute in the future
    if (alarmDate > oneMinuteFromNow) {
      dates.push(alarmDate);
    }
    
    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  // Schedule each alarm
  for (const alarmDate of dates) {
    try {
      const alarmId = Crypto.randomUUID();
      const alarmSchedule = {
        id: alarmId,
        type: 'fixed' as const,
        date: alarmDate,
        time: {
          hour: time.hour,
          minute: time.minute,
        },
      };
      
      const alarmResult = await NativeAlarmManager.scheduleAlarm(
        alarmSchedule,
        {
          title: alarmConfig.title,
          color: alarmConfig.color || '#8ddaff',
          data: {
            notificationId: notificationId,
            ...alarmConfig.data,
          },
          actions: alarmConfig.actions,
        }
      );
      
      // Persist the alarm instance with platformAlarmId
      await insertDailyAlarmInstance(
        notificationId,
        alarmResult.platformAlarmId || alarmId,
        alarmDate.toISOString()
      );
    } catch (error) {
      console.error(`Failed to schedule daily alarm instance for ${alarmDate.toISOString()}:`, error);
      // Continue with other dates even if one fails
    }
  }
};

// Ensure daily alarm window for all daily notifications (replenisher)
export const ensureDailyAlarmWindowForAllNotifications = async (): Promise<void> => {
  const scheduledNotifications = await getAllScheduledNotificationData();
  
  const now = new Date();
  const nowIso = now.toISOString();
  const oneMinuteFromNow = new Date(now.getTime() + 60 * 1000);
  
  // Filter for daily notifications with alarms enabled
  const dailyNotifications = scheduledNotifications.filter(
    n => n.repeatOption === 'daily' && n.hasAlarm
  );
  
  for (const notification of dailyNotifications) {
    try {
      // Get current active future instances
      const activeInstances = await getActiveFutureDailyAlarmInstances(
        notification.notificationId,
        oneMinuteFromNow.toISOString()
      );
      
      // If we have fewer than 14, schedule more
      if (activeInstances.length < 14) {
        const needed = 14 - activeInstances.length;
        
        // Parse the notification trigger to get time
        let hour = 8;
        let minute = 0;
        if (notification.notificationTrigger) {
          const trigger = notification.notificationTrigger as any;
          if (trigger.hour !== undefined) hour = trigger.hour;
          if (trigger.minute !== undefined) minute = trigger.minute;
        }
        
        // Find the latest scheduled date or use scheduleDateTime
        let baseDate = new Date(notification.scheduleDateTime);
        if (activeInstances.length > 0) {
          // Use the latest scheduled instance date
          const latestInstance = activeInstances[activeInstances.length - 1];
          baseDate = new Date(latestInstance.fireDateTime);
          baseDate.setDate(baseDate.getDate() + 1); // Start from next day
        }
        
        // Schedule the needed alarms with basic config (message will come from notification)
        await scheduleDailyAlarmWindow(
          notification.notificationId,
          baseDate,
          { hour, minute },
          {
            title: notification.message || 'Daily Alarm',
            color: '#8ddaff',
            data: {
              notificationId: notification.notificationId,
            },
          },
          needed
        );
      }
    } catch (error) {
      console.error(`Failed to ensure daily alarm window for ${notification.notificationId}:`, error);
      // Continue with other notifications
    }
  }
};

