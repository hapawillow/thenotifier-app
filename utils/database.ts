import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import { logger, makeLogHeader } from './logger';

const LOG_FILE = 'utils/database.ts';

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
        logger.info(makeLogHeader(LOG_FILE, 'initDatabase'), 'Note: repeatOption column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE scheduledNotification ADD COLUMN notificationTrigger TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        logger.info(makeLogHeader(LOG_FILE, 'initDatabase'), 'Note: notificationTrigger column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE scheduledNotification ADD COLUMN hasAlarm INTEGER DEFAULT 0;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        logger.info(makeLogHeader(LOG_FILE, 'initDatabase'), 'Note: hasAlarm column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE scheduledNotification ADD COLUMN calendarId TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        logger.info(makeLogHeader(LOG_FILE, 'initDatabase'), 'Note: calendarId column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE scheduledNotification ADD COLUMN originalEventId TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        logger.info(makeLogHeader(LOG_FILE, 'initDatabase'), 'Note: originalEventId column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE scheduledNotification ADD COLUMN location TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        logger.info(makeLogHeader(LOG_FILE, 'initDatabase'), 'Note: location column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE scheduledNotification ADD COLUMN originalEventTitle TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        logger.info(makeLogHeader(LOG_FILE, 'initDatabase'), 'Note: originalEventTitle column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE scheduledNotification ADD COLUMN originalEventStartDate TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        logger.info(makeLogHeader(LOG_FILE, 'initDatabase'), 'Note: originalEventStartDate column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE scheduledNotification ADD COLUMN originalEventEndDate TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        logger.info(makeLogHeader(LOG_FILE, 'initDatabase'), 'Note: originalEventEndDate column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE scheduledNotification ADD COLUMN originalEventLocation TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        logger.info(makeLogHeader(LOG_FILE, 'initDatabase'), 'Note: originalEventLocation column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE scheduledNotification ADD COLUMN originalEventRecurring TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        logger.info(makeLogHeader(LOG_FILE, 'initDatabase'), 'Note: originalEventRecurring column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE scheduledNotification ADD COLUMN repeatMethod TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        logger.info(makeLogHeader(LOG_FILE, 'initDatabase'), 'Note: repeatMethod column may already exist');
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
        logger.info(makeLogHeader(LOG_FILE, 'initDatabase'), 'Note: repeatOption column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE archivedNotification ADD COLUMN notificationTrigger TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        logger.info(makeLogHeader(LOG_FILE, 'initDatabase'), 'Note: notificationTrigger column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE archivedNotification ADD COLUMN hasAlarm INTEGER DEFAULT 0;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        logger.info(makeLogHeader(LOG_FILE, 'initDatabase'), 'Note: hasAlarm column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE archivedNotification ADD COLUMN calendarId TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        logger.info(makeLogHeader(LOG_FILE, 'initDatabase'), 'Note: calendarId column may already exist');
      }
    }
    try {
      await db.execAsync(`ALTER TABLE archivedNotification ADD COLUMN originalEventId TEXT DEFAULT NULL;`);
    } catch (error: any) {
      // Column might already exist, ignore error
      if (!error.message?.includes('duplicate column')) {
        logger.info(makeLogHeader(LOG_FILE, 'initDatabase'), 'Note: originalEventId column may already exist');
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

    // Create repeatNotificationInstance table if it doesn't exist (for tracking scheduled DATE notification instances for rolling-window repeats)
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS repeatNotificationInstance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parentNotificationId TEXT NOT NULL,
        instanceNotificationId TEXT NOT NULL,
        fireDateTime TEXT NOT NULL,
        isActive INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
        cancelledAt TEXT DEFAULT NULL,
        UNIQUE(parentNotificationId, fireDateTime)
      );
    `);

    // Create indexes for repeatNotificationInstance table
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_repeatNotificationInstance_parentId_isActive ON repeatNotificationInstance (parentNotificationId, isActive);
    `);

    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_repeatNotificationInstance_fireDateTime ON repeatNotificationInstance (fireDateTime);
    `);

    // Create repeatNotificationOccurrence table if it doesn't exist (for tracking delivered occurrences of repeating notifications)
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS repeatNotificationOccurrence (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parentNotificationId TEXT NOT NULL,
        fireDateTime TEXT NOT NULL,
        recordedAt TEXT DEFAULT CURRENT_TIMESTAMP,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        note TEXT DEFAULT NULL,
        link TEXT DEFAULT NULL,
        UNIQUE(parentNotificationId, fireDateTime)
      );
    `);

    // Create indexes for repeatNotificationOccurrence table
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_repeatNotificationOccurrence_parentId_fireDateTime ON repeatNotificationOccurrence (parentNotificationId, fireDateTime);
    `);

    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_repeatNotificationOccurrence_fireDateTime ON repeatNotificationOccurrence (fireDateTime);
    `);

    isInitialized = true;
    logger.info(makeLogHeader(LOG_FILE, 'initDatabase'), 'Database initialized successfully');
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'initDatabase'), 'Database initialization failed:', error);
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
  originalEventRecurring?: string,
  repeatMethod?: 'expo' | 'rollingWindow' | null
) => {
  logger.info(makeLogHeader(LOG_FILE, 'saveScheduledNotificationData'), 'Saving scheduled notification data:', { notificationId, title, message, note, link, scheduleDateTime, scheduleDateTimeLocal, repeatOption, notificationTrigger });
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
    const repeatMethodValue = repeatMethod || null;
    const repeatMethodSql = repeatMethodValue ? `'${escapeSql(repeatMethodValue)}'` : 'NULL';

    // Use INSERT OR REPLACE to either insert new or update existing notification
    await db.execAsync(
      `INSERT OR REPLACE INTO scheduledNotification (notificationId, title, message, note, link, scheduleDateTime, scheduleDateTimeLocal, repeatOption, notificationTrigger, hasAlarm, calendarId, originalEventId, location, originalEventTitle, originalEventStartDate, originalEventEndDate, originalEventLocation, originalEventRecurring, repeatMethod, updatedAt)
      VALUES ('${escapeSql(notificationId)}', '${escapeSql(title)}', '${escapeSql(message)}', '${escapeSql(note)}', '${escapeSql(link)}', '${scheduleDateTime}', '${escapeSql(scheduleDateTimeLocal)}', ${repeatOptionSql}, ${notificationTriggerSql}, ${hasAlarmValue}, ${calendarIdSql}, ${originalEventIdSql}, ${locationSql}, ${originalEventTitleSql}, ${originalEventStartDateSql}, ${originalEventEndDateSql}, ${originalEventLocationSql}, ${originalEventRecurringSql}, ${repeatMethodSql}, CURRENT_TIMESTAMP);`
    );
    logger.info(makeLogHeader(LOG_FILE, 'saveScheduledNotificationData'), 'Notification data saved successfully');
    const result = await getScheduledNotificationData(notificationId);
    logger.info(makeLogHeader(LOG_FILE, 'saveScheduledNotificationData'), 'Saved scheduled notification data:', result);
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
    const result = await db.getFirstAsync<{ notificationId: string; title: string; message: string; note: string; link: string; scheduleDateTime: string; scheduleDateTimeLocal: string; repeatOption: string | null; notificationTrigger: string | null; hasAlarm: number; calendarId: string | null; originalEventId: string | null; repeatMethod: string | null; createdAt: string; updatedAt: string }>(
      `SELECT notificationId, title, message, note, link, scheduleDateTime, scheduleDateTimeLocal, repeatOption, notificationTrigger, hasAlarm, calendarId, originalEventId, repeatMethod, createdAt, updatedAt FROM scheduledNotification WHERE notificationId = '${notificationId.replace(/'/g, "''")}';`
    );
    if (!result) return null;

    // Parse notificationTrigger JSON if it exists
    let parsedTrigger: Notifications.NotificationTriggerInput | undefined;
    if (result.notificationTrigger) {
      try {
        parsedTrigger = JSON.parse(result.notificationTrigger) as Notifications.NotificationTriggerInput;
      } catch (e) {
        logger.error(makeLogHeader(LOG_FILE), 'Failed to parse notificationTrigger JSON:', e);
      }
    }

    return {
      ...result,
      notificationTrigger: parsedTrigger,
    };
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'getScheduledNotificationData'), 'Failed to get scheduled notification data:', error);
    return null;
  }
};

// Get all scheduled notification data
export const getAllScheduledNotificationData = async () => {
  try {
    const db = await openDatabase();
    // First ensure table exists
    await initDatabase();
    const result = await db.getAllAsync<{ id: number; notificationId: string; title: string; message: string; note: string; link: string; scheduleDateTime: string; scheduleDateTimeLocal: string; repeatOption: string | null; notificationTrigger: string | null; hasAlarm: number; calendarId: string | null; originalEventId: string | null; repeatMethod: string | null; createdAt: string; updatedAt: string }>(
      `SELECT id, notificationId, title, message, note, link, scheduleDateTime, scheduleDateTimeLocal, repeatOption, notificationTrigger, hasAlarm, calendarId, originalEventId, repeatMethod, createdAt, updatedAt FROM scheduledNotification ORDER BY scheduleDateTime ASC;`
    );
    if (!result) return [];

    // Parse notificationTrigger JSON for each result
    return result.map(item => {
      let parsedTrigger: Notifications.NotificationTriggerInput | undefined;
      if (item.notificationTrigger) {
        try {
          parsedTrigger = JSON.parse(item.notificationTrigger) as Notifications.NotificationTriggerInput;
        } catch (e) {
          logger.error(makeLogHeader(LOG_FILE), 'Failed to parse notificationTrigger JSON:', e);
        }
      }
      return {
        ...item,
        notificationTrigger: parsedTrigger,
        hasAlarm: item.hasAlarm === 1,
      };
    });
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'getAllScheduledNotificationData'), 'Failed to get all scheduled notification data:', error);
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
    logger.error(makeLogHeader(LOG_FILE, 'getAllScheduledNotificationData'), 'Failed to get all scheduled notification data:', error);
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
          logger.error(makeLogHeader(LOG_FILE), 'Failed to parse notificationTrigger JSON:', e);
        }
      }
      return {
        ...item,
        notificationTrigger: parsedTrigger,
        hasAlarm: item.hasAlarm === 1,
      };
    });
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'getUpcomingCalendarNotifications'), 'Failed to get upcoming calendar notifications:', error);
    return [];
  }
};

// Delete scheduled notification
export const deleteScheduledNotification = async (notificationId: string) => {
  try {
    const db = await openDatabase();
    await initDatabase();
    await db.execAsync(`DELETE FROM scheduledNotification WHERE notificationId = '${notificationId}';`);
    logger.info(makeLogHeader(LOG_FILE, 'deleteScheduledNotification'), 'Scheduled notification deleted successfully');
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'deleteScheduledNotification'), 'Failed to delete scheduled notification:', error);
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
    logger.info(makeLogHeader(LOG_FILE, 'updateScheduledNotificationData'), 'Scheduled notification data updated successfully');
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'updateScheduledNotificationData'), 'Failed to update scheduled notification data:', error);
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
    logger.info(makeLogHeader(LOG_FILE, 'archiveScheduledNotifications'), 'Archived scheduled notification data successfully');

    // Delete past notifications from scheduled table
    await db.execAsync(
      `DELETE FROM scheduledNotification 
      WHERE scheduleDateTime < '${now}' 
      and (repeatOption IS NULL OR repeatOption = 'none');`);
    logger.info(makeLogHeader(LOG_FILE, 'archiveScheduledNotifications'), 'Deleted scheduled notification data successfully');
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'archiveScheduledNotifications'), 'Failed to archive scheduled notification data:', error);
    throw new Error(`Failed to archive scheduled notification data: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Update archived notification data
export const updateArchivedNotificationData = async (notificationId: string) => {
  try {
    const db = await openDatabase();
    await initDatabase();

    await db.execAsync(`UPDATE archivedNotification SET handledAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP WHERE notificationId = '${notificationId}';`);
    logger.info(makeLogHeader(LOG_FILE, 'updateArchivedNotificationData'), 'Archived notification data updated successfully');
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'updateArchivedNotificationData'), 'Failed to update archived notification data:', error);
    throw new Error(`Failed to update archived notification data: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Archive all scheduled notifications as cancelled (for permission removal cleanup)
export const archiveAllScheduledNotificationsAsCancelled = async (cancelledAtIso: string): Promise<void> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const escapeSql = (str: string) => str.replace(/'/g, "''");

    // Archive all scheduled notifications with cancelledAt set
    await db.execAsync(`INSERT OR REPLACE INTO archivedNotification 
      (notificationId, title, message, note, link, scheduleDateTime, scheduleDateTimeLocal, repeatOption, notificationTrigger, hasAlarm, calendarId, originalEventId, createdAt, updatedAt, cancelledAt, archivedAt) 
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
        updatedAt,
        '${escapeSql(cancelledAtIso)}',
        CURRENT_TIMESTAMP
      FROM scheduledNotification;`);
    logger.info(makeLogHeader(LOG_FILE, 'archiveAllScheduledNotificationsAsCancelled'), 'Archived all scheduled notifications as cancelled');
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'archiveAllScheduledNotificationsAsCancelled'), 'Failed to archive all scheduled notifications as cancelled:', error);
    throw new Error(`Failed to archive all scheduled notifications as cancelled: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Delete all scheduled notifications (for permission removal cleanup)
export const deleteAllScheduledNotifications = async (): Promise<void> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    await db.execAsync(`DELETE FROM scheduledNotification;`);
    logger.info(makeLogHeader(LOG_FILE, 'deleteAllScheduledNotifications'), 'Deleted all scheduled notifications');
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'deleteAllScheduledNotifications'), 'Failed to delete all scheduled notifications:', error);
    throw new Error(`Failed to delete all scheduled notifications: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Mark all repeat notification instances as cancelled for all parent notifications
export const markAllRepeatNotificationInstancesCancelledForAllParents = async (): Promise<void> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    await db.execAsync(
      `UPDATE repeatNotificationInstance 
       SET isActive = 0, cancelledAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP 
       WHERE isActive = 1;`
    );
    logger.info(makeLogHeader(LOG_FILE, 'markAllRepeatNotificationInstancesCancelledForAllParents'), 'Marked all repeat notification instances as cancelled');
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'markAllRepeatNotificationInstancesCancelledForAllParents'), 'Failed to mark all repeat notification instances as cancelled:', error);
    throw new Error(`Failed to mark all repeat notification instances as cancelled: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Mark all daily alarm instances as cancelled for all notifications
export const markAllDailyAlarmInstancesCancelledForAllNotifications = async (): Promise<void> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    await db.execAsync(
      `UPDATE dailyAlarmInstance 
       SET isActive = 0, cancelledAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP 
       WHERE isActive = 1;`
    );
    logger.info(makeLogHeader(LOG_FILE, 'markAllDailyAlarmInstancesCancelledForAllNotifications'), 'Marked all daily alarm instances as cancelled');
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'markAllDailyAlarmInstancesCancelledForAllNotifications'), 'Failed to mark all daily alarm instances as cancelled:', error);
    throw new Error(`Failed to mark all daily alarm instances as cancelled: ${error instanceof Error ? error.message : String(error)}`);
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
          logger.error(makeLogHeader(LOG_FILE), 'Failed to parse notificationTrigger JSON:', e);
        }
      }
      return {
        ...item,
        notificationTrigger: parsedTrigger,
        hasAlarm: item.hasAlarm === 1,
      };
    });
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'getAllArchivedNotificationData'), 'Failed to get all archived notification data:', error);
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
        logger.error(makeLogHeader(LOG_FILE), 'Failed to parse notificationTrigger JSON:', e);
      }
    }

    logger.info(makeLogHeader(LOG_FILE, 'getArchivedNotificationData'), 'Archived notification data:', result);
    return {
      ...result,
      notificationTrigger: parsedTrigger,
      hasAlarm: result.hasAlarm === 1,
    };
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'getArchivedNotificationData'), 'Failed to get archived notification data:', error);
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
    logger.info(makeLogHeader(LOG_FILE, 'saveCalendarSelection'), `Calendar selection saved: ${calendarId} = ${isSelected}`);
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'saveCalendarSelection'), 'Failed to save calendar selection:', error);
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
      logger.info(makeLogHeader(LOG_FILE, 'saveCalendarSelections'), 'Calendar selections saved successfully');
    } catch (error) {
      await db.execAsync('ROLLBACK;');
      throw error;
    }
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'saveCalendarSelections'), 'Failed to save calendar selections:', error);
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
    logger.error(makeLogHeader(LOG_FILE, 'checkUpcomingNotificationForCalendarEvent'), 'Failed to check upcoming notification for calendar event:', error);
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
    logger.error(makeLogHeader(LOG_FILE, 'saveIgnoredCalendarEvent'), 'Failed to save ignored calendar event:', error);
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
    logger.error(makeLogHeader(LOG_FILE, 'isCalendarEventIgnored'), 'Failed to check if calendar event is ignored:', error);
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
    logger.error(makeLogHeader(LOG_FILE, 'getCalendarSelection'), 'Failed to get calendar selection:', error);
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
    logger.error(makeLogHeader(LOG_FILE, 'getAllCalendarSelections'), 'Failed to get all calendar selections:', error);
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
    logger.error(makeLogHeader(LOG_FILE, 'getSelectedCalendarIds'), 'Failed to get selected calendar IDs:', error);
    return new Set();
  }
};

// Generic app preference helpers
export const getAppPreference = async (key: string): Promise<string | null> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const escapeSql = (str: string) => str.replace(/'/g, "''");
    const result = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM appPreferences WHERE key = '${escapeSql(key)}';`
    );
    return result?.value || null;
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'getAppPreference'), `Failed to get app preference for key ${key}:`, error);
    return null;
  }
};

export const setAppPreference = async (key: string, value: string): Promise<void> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const escapeSql = (str: string) => str.replace(/'/g, "''");
    await db.execAsync(
      `INSERT OR REPLACE INTO appPreferences (key, value, updatedAt)
      VALUES ('${escapeSql(key)}', '${escapeSql(value)}', CURRENT_TIMESTAMP);`
    );
    logger.info(makeLogHeader(LOG_FILE, 'setAppPreference'), `App preference saved: ${key} = ${value}`);
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'setAppPreference'), `Failed to save app preference for key ${key}:`, error);
    throw new Error(`Failed to save app preference: ${error instanceof Error ? error.message : String(error)}`);
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
    logger.info(makeLogHeader(LOG_FILE, 'saveAlarmPermissionDenied'), `Alarm permission denied state saved: ${denied}`);
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'saveAlarmPermissionDenied'), 'Failed to save alarm permission denied state:', error);
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
    logger.error(makeLogHeader(LOG_FILE, 'getAlarmPermissionDenied'), 'Failed to get alarm permission denied state:', error);
    return false;
  }
};

// Save appearance mode
export const setAppearanceMode = async (mode: 'system' | 'light' | 'dark'): Promise<void> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const escapeSql = (str: string) => str.replace(/'/g, "''");
    await db.execAsync(
      `INSERT OR REPLACE INTO appPreferences (key, value, updatedAt)
      VALUES ('appearanceMode', '${escapeSql(mode)}', CURRENT_TIMESTAMP);`
    );
    logger.info(makeLogHeader(LOG_FILE, 'setAppearanceMode'), `Appearance mode saved: ${mode}`);
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'setAppearanceMode'), 'Failed to save appearance mode:', error);
    throw new Error(`Failed to save appearance mode: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Get appearance mode
export const getAppearanceMode = async (): Promise<'system' | 'light' | 'dark'> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const result = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM appPreferences WHERE key = 'appearanceMode';`
    );
    if (result && (result.value === 'light' || result.value === 'dark' || result.value === 'system')) {
      return result.value as 'system' | 'light' | 'dark';
    }
    return 'system'; // Default to system
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'getAppearanceMode'), 'Failed to get appearance mode:', error);
    return 'system'; // Default to system on error
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
    logger.error(makeLogHeader(LOG_FILE, 'insertDailyAlarmInstance'), 'Failed to insert daily alarm instance:', error);
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
    logger.error(makeLogHeader(LOG_FILE, 'getActiveFutureDailyAlarmInstances'), 'Failed to get active future daily alarm instances:', error);
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
    logger.error(makeLogHeader(LOG_FILE, 'getAllActiveDailyAlarmInstances'), 'Failed to get all active daily alarm instances:', error);
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
    logger.error(makeLogHeader(LOG_FILE, 'markDailyAlarmInstanceCancelled'), 'Failed to mark daily alarm instance as cancelled:', error);
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
    logger.error(makeLogHeader(LOG_FILE, 'markAllDailyAlarmInstancesCancelled'), 'Failed to mark all daily alarm instances as cancelled:', error);
    throw new Error(`Failed to mark all daily alarm instances as cancelled: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Repeat Notification Instance CRUD operations

// Insert a repeat notification instance
export const insertRepeatNotificationInstance = async (
  parentNotificationId: string,
  instanceNotificationId: string,
  fireDateTime: string
): Promise<void> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const escapeSql = (str: string) => str.replace(/'/g, "''");
    await db.execAsync(
      `INSERT OR IGNORE INTO repeatNotificationInstance (parentNotificationId, instanceNotificationId, fireDateTime, isActive, createdAt, updatedAt)
       VALUES ('${escapeSql(parentNotificationId)}', '${escapeSql(instanceNotificationId)}', '${fireDateTime}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`
    );
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'insertRepeatNotificationInstance'), 'Failed to insert repeat notification instance:', error);
    throw new Error(`Failed to insert repeat notification instance: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Get active future repeat notification instances for a parent notification
export const getActiveFutureRepeatNotificationInstances = async (
  parentNotificationId: string,
  nowIso: string
): Promise<Array<{ instanceNotificationId: string; fireDateTime: string }>> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const escapeSql = (str: string) => str.replace(/'/g, "''");
    const result = await db.getAllAsync<{ instanceNotificationId: string; fireDateTime: string }>(
      `SELECT instanceNotificationId, fireDateTime FROM repeatNotificationInstance 
       WHERE parentNotificationId = '${escapeSql(parentNotificationId)}' 
       AND isActive = 1 
       AND fireDateTime > '${nowIso}'
       ORDER BY fireDateTime ASC;`
    );
    return result || [];
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'getActiveFutureRepeatNotificationInstances'), 'Failed to get active future repeat notification instances:', error);
    return [];
  }
};

// Get all active repeat notification instances for a parent notification
export const getAllActiveRepeatNotificationInstances = async (
  parentNotificationId: string
): Promise<Array<{ instanceNotificationId: string; fireDateTime: string }>> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const escapeSql = (str: string) => str.replace(/'/g, "''");
    const result = await db.getAllAsync<{ instanceNotificationId: string; fireDateTime: string }>(
      `SELECT instanceNotificationId, fireDateTime FROM repeatNotificationInstance 
       WHERE parentNotificationId = '${escapeSql(parentNotificationId)}' 
       AND isActive = 1
       ORDER BY fireDateTime ASC;`
    );
    return result || [];
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'getAllActiveRepeatNotificationInstances'), 'Failed to get all active repeat notification instances:', error);
    return [];
  }
};

// Mark a repeat notification instance as cancelled
export const markRepeatNotificationInstanceCancelled = async (instanceNotificationId: string): Promise<void> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const escapeSql = (str: string) => str.replace(/'/g, "''");
    await db.execAsync(
      `UPDATE repeatNotificationInstance 
       SET isActive = 0, cancelledAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP 
       WHERE instanceNotificationId = '${escapeSql(instanceNotificationId)}';`
    );
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'markRepeatNotificationInstanceCancelled'), 'Failed to mark repeat notification instance as cancelled:', error);
    throw new Error(`Failed to mark repeat notification instance as cancelled: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Mark all repeat notification instances for a parent notification as cancelled
export const markAllRepeatNotificationInstancesCancelled = async (parentNotificationId: string): Promise<void> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const escapeSql = (str: string) => str.replace(/'/g, "''");
    await db.execAsync(
      `UPDATE repeatNotificationInstance 
       SET isActive = 0, cancelledAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP 
       WHERE parentNotificationId = '${escapeSql(parentNotificationId)}' AND isActive = 1;`
    );
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'markAllRepeatNotificationInstancesCancelled'), 'Failed to mark all repeat notification instances as cancelled:', error);
    throw new Error(`Failed to mark all repeat notification instances as cancelled: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Date generation helpers for rolling-window notifications

// Helper to clamp day-of-month to last valid day of month (for monthly/yearly)
const clampDayOfMonth = (year: number, month: number, day: number): number => {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return Math.min(day, lastDay);
};

// Generate occurrence dates for rolling-window notifications
export const generateOccurrenceDates = (
  startDate: Date,
  repeatOption: 'daily' | 'weekly' | 'monthly' | 'yearly',
  count: number,
  hour: number,
  minute: number
): Date[] => {
  const now = new Date();
  const oneMinuteFromNow = new Date(now.getTime() + 60 * 1000);
  const dates: Date[] = [];

  let currentDate = new Date(startDate);
  currentDate.setHours(hour, minute, 0, 0);

  // Ensure we start from startDate, but skip if it's in the past
  if (currentDate <= oneMinuteFromNow) {
    // Move to next occurrence
    if (repeatOption === 'daily') {
      currentDate.setDate(currentDate.getDate() + 1);
    } else if (repeatOption === 'weekly') {
      currentDate.setDate(currentDate.getDate() + 7);
    } else if (repeatOption === 'monthly') {
      currentDate.setMonth(currentDate.getMonth() + 1);
      // Clamp day if needed
      const originalDay = startDate.getDate();
      const clampedDay = clampDayOfMonth(currentDate.getFullYear(), currentDate.getMonth(), originalDay);
      currentDate.setDate(clampedDay);
    } else if (repeatOption === 'yearly') {
      currentDate.setFullYear(currentDate.getFullYear() + 1);
      // Clamp day if needed (e.g., Feb 29 -> Feb 28 in non-leap years)
      const originalDay = startDate.getDate();
      const clampedDay = clampDayOfMonth(currentDate.getFullYear(), currentDate.getMonth(), originalDay);
      currentDate.setDate(clampedDay);
    }
  }

  for (let i = 0; i < count; i++) {
    const occurrenceDate = new Date(currentDate);
    occurrenceDate.setHours(hour, minute, 0, 0);

    // Only add if it's at least 1 minute in the future
    if (occurrenceDate > oneMinuteFromNow) {
      dates.push(occurrenceDate);
    }

    // Move to next occurrence
    if (repeatOption === 'daily') {
      currentDate.setDate(currentDate.getDate() + 1);
    } else if (repeatOption === 'weekly') {
      currentDate.setDate(currentDate.getDate() + 7);
    } else if (repeatOption === 'monthly') {
      const originalDay = startDate.getDate();
      currentDate.setMonth(currentDate.getMonth() + 1);
      const clampedDay = clampDayOfMonth(currentDate.getFullYear(), currentDate.getMonth(), originalDay);
      currentDate.setDate(clampedDay);
    } else if (repeatOption === 'yearly') {
      const originalDay = startDate.getDate();
      currentDate.setFullYear(currentDate.getFullYear() + 1);
      const clampedDay = clampDayOfMonth(currentDate.getFullYear(), currentDate.getMonth(), originalDay);
      currentDate.setDate(clampedDay);
    }
  }

  return dates;
};

// Get window size for a repeat option
export const getWindowSize = (repeatOption: 'daily' | 'weekly' | 'monthly' | 'yearly'): number => {
  switch (repeatOption) {
    case 'daily':
      return 14;
    case 'weekly':
      return 4;
    case 'monthly':
      return 4;
    case 'yearly':
      return 2;
    default:
      return 14;
  }
};

// Schedule rolling-window notification instances
export const scheduleRollingWindowNotifications = async (
  parentNotificationId: string,
  startDate: Date,
  repeatOption: 'daily' | 'weekly' | 'monthly' | 'yearly',
  notificationContent: Notifications.NotificationContentInput,
  count?: number
): Promise<{ scheduled: number; skipped: number }> => {
  const hour = startDate.getHours();
  const minute = startDate.getMinutes();
  const windowSize = count || getWindowSize(repeatOption);

  // Generate occurrence dates
  const dates = generateOccurrenceDates(startDate, repeatOption, windowSize, hour, minute);

  let scheduled = 0;
  let skipped = 0;

  // Schedule each DATE notification
  for (const occurrenceDate of dates) {
    try {
      const instanceNotificationId = "thenotifier-instance-" + Crypto.randomUUID();

      // Ensure parentNotificationId is included in notification data for occurrence tracking
      const notificationDataWithParent = {
        ...notificationContent.data,
        notificationId: parentNotificationId,
      };

      const notificationTrigger: Notifications.NotificationTriggerInput = {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: occurrenceDate,
      };

      if (Platform.OS === 'android') {
        (notificationTrigger as any).channelId = "thenotifier";
      }

      await Notifications.scheduleNotificationAsync({
        identifier: instanceNotificationId,
        content: {
          ...notificationContent,
          data: notificationDataWithParent,
        },
        trigger: notificationTrigger,
      });

      // Persist the instance
      await insertRepeatNotificationInstance(
        parentNotificationId,
        instanceNotificationId,
        occurrenceDate.toISOString()
      );

      scheduled++;
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'scheduleRollingWindowNotifications'), `Failed to schedule rolling-window notification instance for ${occurrenceDate.toISOString()}:`, error);
      skipped++;
      // Continue with other dates even if one fails
    }
  }

  return { scheduled, skipped };
};

// Migrate rolling-window repeats to Expo repeats
export const migrateRollingWindowRepeatsToExpo = async (): Promise<void> => {
  logger.info(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), '[RepeatMigration] Starting migration of rolling-window repeats to Expo repeats');

  try {
    const scheduledNotifications = await getAllScheduledNotificationData();
    const now = new Date();

    // Filter eligible notifications
    const eligibleNotifications = scheduledNotifications.filter(n => {
      if (!n.repeatOption || n.repeatOption === 'none') return false;
      if (n.repeatMethod !== 'rollingWindow') return false;
      if (new Date(n.scheduleDateTime) >= now) return false;

      // Verify it's actually rolling-window managed
      const trigger = n.notificationTrigger as any;
      if (trigger?.type === 'DATE_WINDOW') return true;

      // Check if there are active rolling instances
      // We'll check this per notification during processing
      return true;
    });

    logger.info(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] Found ${eligibleNotifications.length} eligible notifications`);

    let migrated = 0;
    let skipped = 0;

    for (const notification of eligibleNotifications) {
      try {
        logger.info(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] Processing notification: ${notification.notificationId}`);

        // Load active rolling instances
        const activeInstances = await getAllActiveRepeatNotificationInstances(notification.notificationId);

        // Skip if no active instances (might have been cleaned up already)
        if (activeInstances.length === 0) {
          logger.info(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] No active instances found for ${notification.notificationId}, skipping`);
          continue;
        }

        logger.info(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] Found ${activeInstances.length} active rolling instances`);

        // Step 2: Capacity guard - cancel latest instance
        const latestInstance = activeInstances.reduce((latest, current) => {
          return new Date(current.fireDateTime) > new Date(latest.fireDateTime) ? current : latest;
        });

        logger.info(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] Cancelling latest instance: ${latestInstance.instanceNotificationId} (fireDateTime: ${latestInstance.fireDateTime})`);

        try {
          await Notifications.cancelScheduledNotificationAsync(latestInstance.instanceNotificationId);
          await markRepeatNotificationInstanceCancelled(latestInstance.instanceNotificationId);
          logger.info(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] Successfully cancelled latest instance`);
        } catch (cancelError: any) {
          const errorMessage = cancelError instanceof Error ? cancelError.message : String(cancelError);
          // Treat "not found" as non-fatal
          if (errorMessage.includes('not found') || errorMessage.includes('NOT_FOUND')) {
            logger.info(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] Latest instance not found (may have already fired), marking as cancelled`);
            await markRepeatNotificationInstanceCancelled(latestInstance.instanceNotificationId);
          } else {
            logger.error(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] Failed to cancel latest instance: ${errorMessage}`);
            skipped++;
            continue;
          }
        }

        // Step 3: Schedule new Expo repeating notification
        const startDate = new Date(notification.scheduleDateTime);
        const hour = startDate.getHours();
        const minute = startDate.getMinutes();
        const day = startDate.getDate();
        const dayOfWeek = startDate.getDay();
        const month = startDate.getMonth();

        let expoTrigger: Notifications.NotificationTriggerInput;
        switch (notification.repeatOption) {
          case 'daily':
            expoTrigger = {
              type: Notifications.SchedulableTriggerInputTypes.DAILY,
              hour: hour,
              minute: minute,
            };
            break;
          case 'weekly':
            expoTrigger = {
              type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
              weekday: dayOfWeek,
              hour: hour,
              minute: minute,
            };
            break;
          case 'monthly':
            expoTrigger = {
              type: Notifications.SchedulableTriggerInputTypes.MONTHLY,
              day: day,
              hour: hour,
              minute: minute,
            };
            break;
          case 'yearly':
            expoTrigger = {
              type: Notifications.SchedulableTriggerInputTypes.YEARLY,
              month: month,
              day: day,
              hour: hour,
              minute: minute,
            };
            break;
          default:
            logger.error(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] Unknown repeatOption: ${notification.repeatOption}`);
            skipped++;
            continue;
        }

        if (Platform.OS === 'android') {
          (expoTrigger as any).channelId = "thenotifier";
        }

        // Build notification content
        const deepLinkUrl = notification.link ? `thenotifier://notification?title=${encodeURIComponent(notification.title)}&message=${encodeURIComponent(notification.message)}&note=${encodeURIComponent(notification.note || '')}&link=${encodeURIComponent(notification.link)}` : `thenotifier://notification?title=${encodeURIComponent(notification.title)}&message=${encodeURIComponent(notification.message)}&note=${encodeURIComponent(notification.note || '')}`;

        const notificationContent: Notifications.NotificationContentInput = {
          title: notification.title,
          body: notification.message,
          data: {
            title: notification.title,
            message: notification.message,
            note: notification.note || '',
            link: notification.link || '',
            url: deepLinkUrl
          },
          sound: 'thenotifier.wav'
        };

        if (Platform.OS === 'android') {
          notificationContent.vibrate = [0, 1000, 500, 1000];
        }
        if (Platform.OS === 'ios') {
          notificationContent.interruptionLevel = 'timeSensitive';
        }

        logger.info(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] Scheduling Expo repeating notification with trigger:`, expoTrigger);
        await Notifications.scheduleNotificationAsync({
          identifier: notification.notificationId,
          content: notificationContent,
          trigger: expoTrigger,
        });
        logger.info(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] Successfully scheduled Expo repeating notification`);

        // Step 4: Handle alarms if necessary
        let alarmHandlingRequired = false;
        let alarmHandlingFailed = false;

        if (notification.hasAlarm) {
          // Check if alarm handling is necessary
          // For now, we'll always reschedule to ensure consistency
          // In a more sophisticated implementation, we could compare alarm configs
          alarmHandlingRequired = true;

          logger.info(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] Handling alarms for ${notification.notificationId}`);

          try {
            const { NativeAlarmManager } = await import('rn-native-alarmkit');

            if (notification.repeatOption === 'daily') {
              // Schedule new daily alarms first (safer order)
              await scheduleDailyAlarmWindow(
                notification.notificationId,
                startDate,
                { hour, minute },
                {
                  title: notification.message,
                  color: '#8ddaff',
                  data: {
                    notificationId: notification.notificationId,
                  },
                },
                14
              );
              logger.info(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] Scheduled new daily alarm window`);

              // Then cancel old daily alarms
              const dailyInstances = await getAllActiveDailyAlarmInstances(notification.notificationId);
              for (const instance of dailyInstances) {
                try {
                  await NativeAlarmManager.cancelAlarm(instance.alarmId);
                  await markDailyAlarmInstanceCancelled(instance.alarmId);
                } catch (alarmCancelError: any) {
                  const errorMessage = alarmCancelError instanceof Error ? alarmCancelError.message : String(alarmCancelError);
                  if (!errorMessage.includes('not found') && !errorMessage.includes('ALARM_NOT_FOUND')) {
                    throw alarmCancelError; // Re-throw if it's a real error
                  }
                }
              }
              logger.info(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] Cancelled old daily alarm instances`);
            } else {
              // Weekly/monthly/yearly: schedule new alarm first
              const alarmId = notification.notificationId.substring("thenotifier-".length);
              let alarmSchedule: any;

              if (notification.repeatOption === 'weekly') {
                alarmSchedule = {
                  id: alarmId,
                  type: 'recurring',
                  repeatInterval: 'weekly',
                  startDate: startDate,
                  time: { hour, minute },
                  daysOfWeek: [dayOfWeek],
                };
              } else if (notification.repeatOption === 'monthly') {
                alarmSchedule = {
                  id: alarmId,
                  type: 'recurring',
                  repeatInterval: 'monthly',
                  startDate: startDate,
                  time: { hour, minute },
                  dayOfMonth: day,
                };
              } else if (notification.repeatOption === 'yearly') {
                alarmSchedule = {
                  id: alarmId,
                  type: 'recurring',
                  repeatInterval: 'yearly',
                  startDate: startDate,
                  time: { hour, minute },
                  monthOfYear: month, // Expo uses 0-11 (January = 0)
                  dayOfMonth: day,
                };
              }

              await NativeAlarmManager.scheduleAlarm(
                alarmSchedule,
                {
                  title: notification.message,
                  color: '#8ddaff',
                  data: {
                    notificationId: notification.notificationId,
                  },
                }
              );
              logger.info(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] Scheduled new ${notification.repeatOption} alarm`);

              // Then cancel old alarm
              try {
                await NativeAlarmManager.cancelAlarm(alarmId);
                logger.info(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] Cancelled old alarm`);
              } catch (alarmCancelError: any) {
                const errorMessage = alarmCancelError instanceof Error ? alarmCancelError.message : String(alarmCancelError);
                if (!errorMessage.includes('not found') && !errorMessage.includes('ALARM_NOT_FOUND')) {
                  throw alarmCancelError; // Re-throw if it's a real error
                }
              }
            }
          } catch (alarmError) {
            logger.error(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] Alarm handling failed for ${notification.notificationId}:`, alarmError);
            alarmHandlingFailed = true;

            // Rollback: cancel newly scheduled Expo notification
            try {
              await Notifications.cancelScheduledNotificationAsync(notification.notificationId);
              logger.info(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] Rolled back Expo notification due to alarm failure`);
            } catch (rollbackError) {
              logger.error(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] Failed to rollback Expo notification:`, rollbackError);
            }

            skipped++;
            continue;
          }
        }

        // Step 5: Update DB
        await saveScheduledNotificationData(
          notification.notificationId,
          notification.title,
          notification.message,
          notification.note || '',
          notification.link || '',
          notification.scheduleDateTime,
          notification.scheduleDateTimeLocal,
          notification.repeatOption || undefined,
          expoTrigger,
          notification.hasAlarm,
          notification.calendarId || undefined,
          notification.originalEventId || undefined,
          undefined, // location
          undefined, // originalEventTitle
          undefined, // originalEventStartDate
          undefined, // originalEventEndDate
          undefined, // originalEventLocation
          undefined, // originalEventRecurring
          'expo'
        );
        logger.info(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] Updated DB: set repeatMethod='expo'`);

        // Step 6: Cleanup old rolling-window artifacts
        const remainingInstances = activeInstances.filter(inst => inst.instanceNotificationId !== latestInstance.instanceNotificationId);
        logger.info(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] Cleaning up ${remainingInstances.length} remaining rolling instances`);

        for (const instance of remainingInstances) {
          try {
            await Notifications.cancelScheduledNotificationAsync(instance.instanceNotificationId);
            await markRepeatNotificationInstanceCancelled(instance.instanceNotificationId);
          } catch (cleanupError: any) {
            const errorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
            // Treat "not found" as non-fatal
            if (errorMessage.includes('not found') || errorMessage.includes('NOT_FOUND')) {
              await markRepeatNotificationInstanceCancelled(instance.instanceNotificationId);
            } else {
              logger.error(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] Failed to cleanup instance ${instance.instanceNotificationId}: ${errorMessage}`);
            }
          }
        }

        migrated++;
        logger.info(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] Successfully migrated ${notification.notificationId}`);

      } catch (error) {
        logger.error(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] Failed to migrate ${notification.notificationId}:`, error);
        skipped++;
      }
    }

    logger.info(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), `[RepeatMigration] Migration complete: ${migrated} migrated, ${skipped} skipped`);
  } catch (error) {
    logger.error(makeLogHeader(LOG_FILE, 'migrateRollingWindowRepeatsToExpo'), '[RepeatMigration] Migration failed:', error);
  }
};

// Ensure rolling-window notification instances for all rolling-window managed notifications (replenisher)
export const ensureRollingWindowNotificationInstances = async (): Promise<void> => {
  const scheduledNotifications = await getAllScheduledNotificationData();

  const now = new Date();
  const oneMinuteFromNow = new Date(now.getTime() + 60 * 1000);

  // Filter for rolling-window managed notifications
  const rollingWindowNotifications = scheduledNotifications.filter(
    n => {
      if (!n.repeatOption || n.repeatOption === 'none') return false;
      if (!n.notificationTrigger) return false;
      const trigger = n.notificationTrigger as any;
      return trigger.type === 'DATE_WINDOW';
    }
  );

  for (const notification of rollingWindowNotifications) {
    try {
      const repeatOption = notification.repeatOption as 'daily' | 'weekly' | 'monthly' | 'yearly';
      if (!repeatOption) continue;

      // Get current active future instances
      const activeInstances = await getActiveFutureRepeatNotificationInstances(
        notification.notificationId,
        oneMinuteFromNow.toISOString()
      );

      const windowSize = getWindowSize(repeatOption);

      // If we have fewer than required, schedule more
      if (activeInstances.length < windowSize) {
        const needed = windowSize - activeInstances.length;

        // Parse the notification trigger to get time
        let hour = 8;
        let minute = 0;
        const startDate = new Date(notification.scheduleDateTime);
        hour = startDate.getHours();
        minute = startDate.getMinutes();

        // Find the latest scheduled date or use scheduleDateTime
        let baseDate = new Date(notification.scheduleDateTime);
        if (activeInstances.length > 0) {
          // Use the latest scheduled instance date
          const latestInstance = activeInstances[activeInstances.length - 1];
          baseDate = new Date(latestInstance.fireDateTime);
          // Move to next occurrence based on repeat option
          if (repeatOption === 'daily') {
            baseDate.setDate(baseDate.getDate() + 1);
          } else if (repeatOption === 'weekly') {
            baseDate.setDate(baseDate.getDate() + 7);
          } else if (repeatOption === 'monthly') {
            const originalDay = new Date(notification.scheduleDateTime).getDate();
            baseDate.setMonth(baseDate.getMonth() + 1);
            const clampedDay = clampDayOfMonth(baseDate.getFullYear(), baseDate.getMonth(), originalDay);
            baseDate.setDate(clampedDay);
          } else if (repeatOption === 'yearly') {
            const originalDay = new Date(notification.scheduleDateTime).getDate();
            baseDate.setFullYear(baseDate.getFullYear() + 1);
            const clampedDay = clampDayOfMonth(baseDate.getFullYear(), baseDate.getMonth(), originalDay);
            baseDate.setDate(clampedDay);
          }
        }

        // Build notification content from stored notification data
        const notificationContent: Notifications.NotificationContentInput = {
          title: notification.title,
          body: notification.message,
          data: {
            title: notification.title,
            message: notification.message,
            note: notification.note || '',
            link: notification.link || '',
            url: notification.link ? `thenotifier://notification?title=${encodeURIComponent(notification.title)}&message=${encodeURIComponent(notification.message)}&note=${encodeURIComponent(notification.note || '')}&link=${encodeURIComponent(notification.link || '')}` : `thenotifier://notification?title=${encodeURIComponent(notification.title)}&message=${encodeURIComponent(notification.message)}&note=${encodeURIComponent(notification.note || '')}`
          },
          sound: 'thenotifier.wav'
        };

        if (Platform.OS === 'android') {
          notificationContent.vibrate = [0, 1000, 500, 1000];
        }
        if (Platform.OS === 'ios') {
          notificationContent.interruptionLevel = 'timeSensitive';
        }

        // Schedule the needed notifications
        await scheduleRollingWindowNotifications(
          notification.notificationId,
          baseDate,
          repeatOption,
          notificationContent,
          needed
        );
      }
    } catch (error) {
      logger.error(makeLogHeader(LOG_FILE, 'ensureRollingWindowNotificationInstances'), `Failed to ensure rolling-window notification instances for ${notification.notificationId}:`, error);
      // Continue with other notifications
    }
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
      logger.error(makeLogHeader(LOG_FILE, 'scheduleDailyAlarmWindow'), `Failed to schedule daily alarm instance for ${alarmDate.toISOString()}:`, error);
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
      logger.error(makeLogHeader(LOG_FILE, 'ensureDailyAlarmWindowForAllNotifications'), `Failed to ensure daily alarm window for ${notification.notificationId}:`, error);
      // Continue with other notifications
    }
  }
};

// Repeat Notification Occurrence CRUD operations

// Insert a repeat notification occurrence
export const insertRepeatOccurrence = async (
  parentNotificationId: string,
  fireDateTime: string,
  source: 'tap' | 'foreground' | 'catchup',
  snapshot: { title: string; message: string; note?: string | null; link?: string | null }
): Promise<void> => {
  try {
    const db = await openDatabase();
    await initDatabase();

    const escapeSql = (str: string) => str.replace(/'/g, "''");
    const titleSql = `'${escapeSql(snapshot.title)}'`;
    const messageSql = `'${escapeSql(snapshot.message)}'`;
    const noteSql = snapshot.note ? `'${escapeSql(snapshot.note)}'` : 'NULL';
    const linkSql = snapshot.link ? `'${escapeSql(snapshot.link)}'` : 'NULL';
    const sourceSql = `'${escapeSql(source)}'`;

    // Use INSERT OR IGNORE to prevent duplicates (idempotent)
    await db.execAsync(`
      INSERT OR IGNORE INTO repeatNotificationOccurrence 
      (parentNotificationId, fireDateTime, source, title, message, note, link, recordedAt)
      VALUES 
      ('${escapeSql(parentNotificationId)}', '${fireDateTime}', ${sourceSql}, ${titleSql}, ${messageSql}, ${noteSql}, ${linkSql}, CURRENT_TIMESTAMP);
    `);
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'insertRepeatOccurrence'), 'Failed to insert repeat occurrence:', error);
    throw new Error(`Failed to insert repeat occurrence: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Get latest repeat occurrence fire date for a parent notification
export const getLatestRepeatOccurrenceFireDate = async (parentNotificationId: string): Promise<string | null> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const result = await db.getFirstAsync<{ maxFireDateTime: string | null }>(
      `SELECT MAX(fireDateTime) as maxFireDateTime FROM repeatNotificationOccurrence WHERE parentNotificationId = '${parentNotificationId.replace(/'/g, "''")}';`
    );
    return result?.maxFireDateTime || null;
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'getLatestRepeatOccurrenceFireDate'), 'Failed to get latest repeat occurrence fire date:', error);
    return null;
  }
};

// Get repeat occurrences (for Past tab)
export const getRepeatOccurrences = async (limit?: number, sinceIso?: string): Promise<Array<{
  id: number;
  parentNotificationId: string;
  fireDateTime: string;
  recordedAt: string;
  source: string;
  title: string;
  message: string;
  note: string | null;
  link: string | null;
}>> => {
  try {
    const db = await openDatabase();
    await initDatabase();

    let query = `SELECT id, parentNotificationId, fireDateTime, recordedAt, source, title, message, note, link 
                 FROM repeatNotificationOccurrence`;

    if (sinceIso) {
      query += ` WHERE fireDateTime >= '${sinceIso.replace(/'/g, "''")}'`;
    }

    query += ` ORDER BY fireDateTime DESC`;

    if (limit) {
      query += ` LIMIT ${limit}`;
    }

    const result = await db.getAllAsync<{
      id: number;
      parentNotificationId: string;
      fireDateTime: string;
      recordedAt: string;
      source: string;
      title: string;
      message: string;
      note: string | null;
      link: string | null;
    }>(query);

    return result || [];
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'getRepeatOccurrences'), 'Failed to get repeat occurrences:', error);
    return [];
  }
};

// Catch up repeat occurrences (for notifications that fired while app was inactive)
export const catchUpRepeatOccurrences = async (): Promise<void> => {
  try {
    const db = await openDatabase();
    await initDatabase();

    const scheduledNotifications = await getAllScheduledNotificationData();
    const now = new Date();
    const nowIso = now.toISOString();

    // Filter for repeating notifications
    const repeatingNotifications = scheduledNotifications.filter(
      n => n.repeatOption && n.repeatOption !== 'none' && ['daily', 'weekly', 'monthly', 'yearly'].includes(n.repeatOption)
    );

    logger.info(makeLogHeader(LOG_FILE, 'catchUpRepeatOccurrences'), `[CatchUp] Found ${repeatingNotifications.length} repeating notifications to check`);

    for (const notification of repeatingNotifications) {
      try {
        // Get latest recorded occurrence, or use scheduleDateTime as starting point
        const lastFireIso = await getLatestRepeatOccurrenceFireDate(notification.notificationId);
        const startDate = lastFireIso ? new Date(lastFireIso) : new Date(notification.scheduleDateTime);

        // Skip if startDate is in the future
        if (startDate >= now) {
          continue;
        }

        // Compute expected occurrences between startDate (exclusive) and now (inclusive)
        const occurrences: Date[] = [];
        let currentDate = new Date(startDate);
        const maxOccurrences = 200; // Cap to avoid huge loops

        // Get snapshot data from parent notification
        const snapshot = {
          title: notification.title,
          message: notification.message,
          note: notification.note || null,
          link: notification.link || null,
        };

        // Determine increment based on repeatOption
        while (currentDate < now && occurrences.length < maxOccurrences) {
          // Increment to next occurrence
          switch (notification.repeatOption) {
            case 'daily':
              currentDate.setDate(currentDate.getDate() + 1);
              break;
            case 'weekly':
              currentDate.setDate(currentDate.getDate() + 7);
              break;
            case 'monthly': {
              const originalDay = new Date(notification.scheduleDateTime).getDate();
              currentDate.setMonth(currentDate.getMonth() + 1);
              const clampedDay = clampDayOfMonth(currentDate.getFullYear(), currentDate.getMonth(), originalDay);
              currentDate.setDate(clampedDay);
              break;
            }
            case 'yearly': {
              const originalDay = new Date(notification.scheduleDateTime).getDate();
              const originalMonth = new Date(notification.scheduleDateTime).getMonth();
              currentDate.setFullYear(currentDate.getFullYear() + 1);
              const clampedDay = clampDayOfMonth(currentDate.getFullYear(), originalMonth, originalDay);
              currentDate.setDate(clampedDay);
              currentDate.setMonth(originalMonth);
              break;
            }
          }

          // Only add if still in the past
          if (currentDate <= now) {
            occurrences.push(new Date(currentDate));
          } else {
            break;
          }
        }

        // Insert occurrences with source 'catchup'
        for (const occurrenceDate of occurrences) {
          await insertRepeatOccurrence(
            notification.notificationId,
            occurrenceDate.toISOString(),
            'catchup',
            snapshot
          );
        }

        if (occurrences.length > 0) {
          logger.info(makeLogHeader(LOG_FILE, 'catchUpRepeatOccurrences'), `[CatchUp] Inserted ${occurrences.length} catch-up occurrences for ${notification.notificationId}`);
        }
      } catch (error) {
        logger.error(makeLogHeader(LOG_FILE, 'catchUpRepeatOccurrences'), `[CatchUp] Failed to catch up occurrences for ${notification.notificationId}:`, error);
        // Continue with other notifications
      }
    }

    logger.info(makeLogHeader(LOG_FILE, 'catchUpRepeatOccurrences'), '[CatchUp] Catch-up complete');
  } catch (error) {
    logger.error(makeLogHeader(LOG_FILE, 'catchUpRepeatOccurrences'), '[CatchUp] Catch-up failed:', error);
  }
};

// Get app language preference
export const getAppLanguage = async (): Promise<string> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const result = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM appPreferences WHERE key = 'appLanguage';`
    );
    if (result && result.value) {
      return result.value;
    }
    // Default to 'en' if not set, and save it
    await setAppLanguage('en');
    return 'en';
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'getAppLanguage'), 'Failed to get app language:', error);
    return 'en'; // Default to 'en' on error
  }
};

// Set app language preference
export const setAppLanguage = async (lang: string): Promise<void> => {
  try {
    const db = await openDatabase();
    await initDatabase();
    const escapeSql = (str: string) => str.replace(/'/g, "''");
    await db.execAsync(
      `INSERT OR REPLACE INTO appPreferences (key, value, updatedAt)
      VALUES ('appLanguage', '${escapeSql(lang)}', CURRENT_TIMESTAMP);`
    );
    logger.info(makeLogHeader(LOG_FILE, 'setAppLanguage'), `App language saved: ${lang}`);
  } catch (error: any) {
    logger.error(makeLogHeader(LOG_FILE, 'setAppLanguage'), 'Failed to save app language:', error);
    throw new Error(`Failed to save app language: ${error instanceof Error ? error.message : String(error)}`);
  }
};

