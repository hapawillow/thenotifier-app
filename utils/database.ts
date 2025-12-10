import * as Notifications from 'expo-notifications';
import * as SQLite from 'expo-sqlite';

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
  originalEventId?: string
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

    // Use INSERT OR REPLACE to either insert new or update existing notification
    await db.execAsync(
      `INSERT OR REPLACE INTO scheduledNotification (notificationId, title, message, note, link, scheduleDateTime, scheduleDateTimeLocal, repeatOption, notificationTrigger, hasAlarm, calendarId, originalEventId, updatedAt)
      VALUES ('${escapeSql(notificationId)}', '${escapeSql(title)}', '${escapeSql(message)}', '${escapeSql(note)}', '${escapeSql(link)}', '${scheduleDateTime}', '${escapeSql(scheduleDateTimeLocal)}', ${repeatOptionSql}, ${notificationTriggerSql}, ${hasAlarmValue}, ${calendarIdSql}, ${originalEventIdSql}, CURRENT_TIMESTAMP);`
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

    const result = await db.getAllAsync<{ id: number; notificationId: string; title: string; message: string; note: string; link: string; scheduleDateTime: string; scheduleDateTimeLocal: string; repeatOption: string | null; notificationTrigger: string | null; hasAlarm: number; calendarId: string | null; originalEventId: string | null; createdAt: string; updatedAt: string }>(
      `SELECT id, notificationId, title, message, note, link, scheduleDateTime, scheduleDateTimeLocal, repeatOption, notificationTrigger, hasAlarm, calendarId, originalEventId, createdAt, updatedAt FROM scheduledNotification ORDER BY scheduleDateTime ASC;`
    );

    const debug_allScheduledNotificationData = await getAllScheduledNotificationData();
    console.log('Debug all scheduled notification data:', debug_allScheduledNotificationData);

    // const debug_archiveQueryResult = await db.getAllAsync<{
    //   now: string;
    //   notificationId: string;
    //   title: string;
    //   message: string;
    //   note: string;
    //   link: string;
    //   scheduleDateTime: string;
    //   scheduleDateTimeLocal: string;
    //   repeatOption: string | null;
    //   notificationTrigger: string | null;
    //   hasAlarm: number;
    //   calendarId: string | null;
    //   originalEventId: string | null;
    //   createdAt: string;
    //   updatedAt: string;
    // }>(
    //   `SELECT
    //     '${now}' as now,
    //     notificationId,
    //     title,
    //     message,
    //     note,
    //     link,
    //     scheduleDateTime,
    //     scheduleDateTimeLocal,
    //     repeatOption,
    //     notificationTrigger,
    //     hasAlarm,
    //     calendarId,
    //     originalEventId,
    //     createdAt,
    //     updatedAt
    //   FROM scheduledNotification
    // WHERE scheduleDateTime < '${now}'
    // and (repeatOption IS NULL OR repeatOption = 'none')`);
    // console.log('Debug archive query result:', debug_archiveQueryResult);

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

    // const debug_deleteQueryResult = await db.getAllAsync<{
    //   now: string;
    //   notificationId: string;
    //   title: string;
    //   message: string;
    //   note: string;
    //   link: string;
    //   scheduleDateTime: string;
    //   scheduleDateTimeLocal: string;
    //   repeatOption: string | null;
    //   notificationTrigger: string | null;
    //   hasAlarm: number;
    //   calendarId: string | null;
    //   originalEventId: string | null;
    //   createdAt: string;
    //   updatedAt: string;
    // }>(
    //   `SELECT
    //     notificationId,
    //     title,
    //     message,
    //     note,
    //     link,
    //     scheduleDateTime,
    //     scheduleDateTimeLocal,
    //     repeatOption,
    //     notificationTrigger,
    //     hasAlarm,
    //     calendarId,
    //     originalEventId,
    //     createdAt,
    //     updatedAt
    //   FROM scheduledNotification
    //   WHERE scheduleDateTime < '${now}' 
    //   and (repeatOption IS NULL OR repeatOption = 'none');`);
    // console.log('Debug delete query result:', debug_deleteQueryResult);


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

