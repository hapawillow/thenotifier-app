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
        shortMessage TEXT NOT NULL,
        longMessage TEXT NOT NULL,
        link TEXT DEFAULT NULL,
        scheduleDateTime TEXT NOT NULL,
        scheduleDateTimeLocal TEXT NOT NULL,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create indexes for scheduledNotification table
    await db.execAsync(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduledNotification_notificationId ON scheduledNotification (notificationId);
    `);

    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_scheduledNotification_scheduleDateTime ON scheduledNotification (scheduleDateTime);
    `);

    // Create archivedNotification table if it doesn't exist
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS archivedNotification (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        notificationId TEXT NOT NULL,
        title TEXT NOT NULL,
        shortMessage TEXT NOT NULL,
        longMessage TEXT NOT NULL,
        link TEXT DEFAULT NULL,
        scheduleDateTime TEXT NOT NULL,
        scheduleDateTimeLocal TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        handledAt TEXT DEFAULT NULL,
        cancelledAt TEXT DEFAULT NULL,
        archivedAt TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create indexes for archivedNotification table
    await db.execAsync(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_archivedNotification_notificationId ON archivedNotification (notificationId);
    `);

    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_archivedNotification_scheduleDateTime ON archivedNotification (scheduleDateTime);
    `);

    isInitialized = true;
    console.log('Database initialized successfully');
  } catch (error: any) {
    console.error('Database initialization failed:', error);
    throw new Error(`Database initialization failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Save scheduled notification data
export const saveScheduledNotificationData = async (notificationId: string, title: string, shortMessage: string, longMessage: string, link: string, scheduleDateTime: string, scheduleDateTimeLocal: string) => {
  try {
    const db = await openDatabase();
    // First ensure table exists
    await initDatabase();
    // Then delete any existing data
    await db.execAsync('DELETE FROM scheduledNotification;');

    // Then insert new data
    await db.execAsync(
      `INSERT INTO scheduledNotification (notificationId, title, shortMessage, longMessage, link, scheduleDateTime, scheduleDateTimeLocal)
      VALUES ('${notificationId}', '${title}', '${shortMessage}', '${longMessage}', '${link}', '${scheduleDateTime}', '${scheduleDateTimeLocal}');`
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
    const result = await db.getFirstAsync<{ notificationId: string; title: string; shortMessage: string; longMessage: string; link: string; scheduleDateTime: string; scheduleDateTimeLocal: string; createdAt: string; updatedAt: string }>(
      `SELECT notificationId, title, shortMessage, longMessage, link, scheduleDateTime, scheduleDateTimeLocal, createdAt, updatedAt FROM scheduledNotification WHERE notificationId = '${notificationId}';`
    );
    return result || null;
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
    const result = await db.getFirstAsync<{ notificationId: string; title: string; shortMessage: string; longMessage: string; link: string; scheduleDateTime: string; scheduleDateTimeLocal: string; createdAt: string; updatedAt: string }>(
      `SELECT notificationId, title, shortMessage, longMessage, link, scheduleDateTime, scheduleDateTimeLocal, createdAt, updatedAt FROM scheduledNotification;`
    );
    return result || null;
  } catch (error: any) {
    console.error('Failed to get all scheduled notification data:', error);
    return null;
  }
};

// Archive scheduled notification data
export const archiveScheduledNotifications = async () => {
  try {
    const db = await openDatabase();
    await initDatabase();
    await db.execAsync(`INSERT OR REPLACE INTO archivedNotification (notificationId, title, shortMessage, longMessage, link, scheduleDateTime, scheduleDateTimeLocal, createdAt, updatedAt) 
      SELECT
        notificationId,
        title,
        shortMessage,
        longMessage,
        link,
        scheduleDateTime,
        scheduleDateTimeLocal,
        createdAt,
        updatedAt
      FROM scheduledNotification
      WHERE scheduleDateTime > CURRENT_TIMESTAMP;`);
    console.log('Archived scheduled notification data successfully');
    await db.execAsync(`DELETE FROM scheduledNotification WHERE scheduleDateTime > CURRENT_TIMESTAMP;`);
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

// Get archived notification data
export const getArchivedNotificationData = async (notificationId: string) => {
  try {
    const db = await openDatabase();
    await initDatabase();
    // console.log('Getting archived notification data for notificationId:', notificationId);
    const result = await db.getFirstAsync<{ notificationId: string; title: string; shortMessage: string; longMessage: string; link: string; scheduleDateTime: string; scheduleDateTimeLocal: string; createdAt: string; updatedAt: string; handledAt: string }>(
      `SELECT * FROM archivedNotification WHERE notificationId = '${notificationId}';`
    );
    console.log('Archived notification data:', result);
    return result || null;
  } catch (error: any) {
    console.error('Failed to get archived notification data:', error);
    return null;
  }
};

