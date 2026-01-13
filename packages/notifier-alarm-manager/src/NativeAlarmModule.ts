/**
 * Native module bridge for alarm operations
 * Low-level interface to native iOS and Android implementations
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import type {
  AlarmSchedule,
  AlarmConfig,
  ScheduledAlarm,
  AlarmCapabilityCheck,
  AlarmFiredEvent,
  PermissionChangedEvent,
  DeepLinkEvent,
} from './types';
import { AlarmError, AlarmErrorCode } from './types';

const LINKING_ERROR =
  `The package 'notifier-alarm-manager' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ ios: "- Run 'pod install'\n", default: '' }) +
  '- You rebuilt the app after installing the package\n' +
  '- You are not using Expo Go\n';

/**
 * Native module specification (TurboModule compatible)
 */
interface NativeAlarmsSpec {
  // Capability & Permissions
  checkCapability(): Promise<AlarmCapabilityCheck>;
  requestPermission(): Promise<boolean>;

  // Scheduling
  scheduleAlarm(
    schedule: AlarmSchedule,
    config: AlarmConfig
  ): Promise<ScheduledAlarm>;
  updateAlarm(
    id: string,
    schedule: AlarmSchedule,
    config: AlarmConfig
  ): Promise<ScheduledAlarm>;

  // Management
  cancelAlarm(id: string): Promise<void>;
  cancelAllAlarms(): Promise<void>;
  cancelAlarmsByCategory(category: string): Promise<void>;

  // Actions
  stopAlarmSoundAndDismiss?(alarmId: string): Promise<void>;

  // Query
  getAlarm(id: string): Promise<ScheduledAlarm | null>;
  getAllAlarms(): Promise<ScheduledAlarm[]>;
  getAlarmsByCategory(category: string): Promise<ScheduledAlarm[]>;

  // Actions
  snoozeAlarm(id: string, minutes: number): Promise<void>;

  // Deep link handoff (iOS only)
  getPendingDeepLink(): Promise<string | null>;

  // Constants
  getConstants(): {
    ALARM_FIRED_EVENT: string;
    PERMISSION_CHANGED_EVENT: string;
  };
}

/**
 * Get native module with error handling
 */
const NativeAlarmsModule = NativeModules.NotifierNativeAlarms
  ? (NativeModules.NotifierNativeAlarms as NativeAlarmsSpec)
  : new Proxy(
      {},
      {
        get() {
          throw new AlarmError(
            AlarmErrorCode.MODULE_NOT_LINKED,
            LINKING_ERROR
          );
        },
      }
    ) as NativeAlarmsSpec;

/**
 * Event emitter for native events
 * Only create if the module supports event listeners (has addListener method)
 * This prevents warnings on Android where the module may not implement the required methods
 */
const createEventEmitter = () => {
  const module = NativeModules.NotifierNativeAlarms;
  if (!module) {
    return null;
  }
  
    // Check if module supports event listeners (required for NativeEventEmitter)
    // On Android, some modules may not implement addListener/removeListeners
    // This is expected behavior - Android uses direct intent handling instead of events
    if (Platform.OS === 'android' && typeof module.addListener !== 'function') {
      // Don't log warning - this is expected on Android
      return null;
    }
  
  try {
    return new NativeEventEmitter(module);
  } catch (error) {
    console.warn('[NativeAlarmModule] Failed to create NativeEventEmitter:', error);
    return null;
  }
};

const eventEmitter = createEventEmitter();

/**
 * Event names from native module
 */
const EVENTS = NativeAlarmsModule.getConstants?.() || {
  ALARM_FIRED_EVENT: 'NotifierNativeAlarms_AlarmFired',
  PERMISSION_CHANGED_EVENT: 'NotifierNativeAlarms_PermissionChanged',
  DEEP_LINK_EVENT: 'NotifierNativeAlarms_DeepLink',
};

/**
 * Wrapped native module with error handling and type safety
 */
export const NativeAlarmModule = {
  /**
   * Check device alarm capability
   */
  async checkCapability(): Promise<AlarmCapabilityCheck> {
    try {
      return await NativeAlarmsModule.checkCapability();
    } catch (error) {
      throw new AlarmError(
        AlarmErrorCode.SYSTEM_ERROR,
        'Failed to check capability',
        error
      );
    }
  },

  /**
   * Request alarm permission
   */
  async requestPermission(): Promise<boolean> {
    try {
      return await NativeAlarmsModule.requestPermission();
    } catch (error) {
      throw new AlarmError(
        AlarmErrorCode.SYSTEM_ERROR,
        'Failed to request permission',
        error
      );
    }
  },

  /**
   * Schedule a new alarm
   */
  async scheduleAlarm(
    schedule: AlarmSchedule,
    config: AlarmConfig
  ): Promise<ScheduledAlarm> {
    try {
      const alarm = await NativeAlarmsModule.scheduleAlarm(schedule, config);

      // Convert date strings to Date objects
      return {
        ...alarm,
        nextFireDate: new Date(alarm.nextFireDate),
      };
    } catch (error: any) {
      if (error.code) {
        throw new AlarmError(
          error.code as AlarmErrorCode,
          error.message,
          error
        );
      }
      throw new AlarmError(
        AlarmErrorCode.SYSTEM_ERROR,
        'Failed to schedule alarm',
        error
      );
    }
  },

  /**
   * Update an existing alarm
   */
  async updateAlarm(
    id: string,
    schedule: AlarmSchedule,
    config: AlarmConfig
  ): Promise<ScheduledAlarm> {
    try {
      const alarm = await NativeAlarmsModule.updateAlarm(id, schedule, config);

      return {
        ...alarm,
        nextFireDate: new Date(alarm.nextFireDate),
      };
    } catch (error: any) {
      if (error.code) {
        throw new AlarmError(
          error.code as AlarmErrorCode,
          error.message,
          error
        );
      }
      throw new AlarmError(
        AlarmErrorCode.SYSTEM_ERROR,
        'Failed to update alarm',
        error
      );
    }
  },

  /**
   * Cancel an alarm by ID
   */
  async cancelAlarm(id: string): Promise<void> {
    try {
      await NativeAlarmsModule.cancelAlarm(id);
    } catch (error: any) {
      if (error.code === 'ALARM_NOT_FOUND') {
        throw new AlarmError(
          AlarmErrorCode.ALARM_NOT_FOUND,
          `Alarm with ID '${id}' not found`
        );
      }
      throw new AlarmError(
        AlarmErrorCode.SYSTEM_ERROR,
        'Failed to cancel alarm',
        error
      );
    }
  },

  /**
   * Cancel all alarms
   */
  async cancelAllAlarms(): Promise<void> {
    try {
      await NativeAlarmsModule.cancelAllAlarms();
    } catch (error) {
      throw new AlarmError(
        AlarmErrorCode.SYSTEM_ERROR,
        'Failed to cancel all alarms',
        error
      );
    }
  },

  /**
   * Cancel alarms by category
   */
  async cancelAlarmsByCategory(category: string): Promise<void> {
    try {
      await NativeAlarmsModule.cancelAlarmsByCategory(category);
    } catch (error) {
      throw new AlarmError(
        AlarmErrorCode.SYSTEM_ERROR,
        'Failed to cancel alarms by category',
        error
      );
    }
  },

  /**
   * Stop alarm sound and dismiss notification (Android only)
   */
  async stopAlarmSoundAndDismiss(alarmId: string): Promise<void> {
    if (Platform.OS !== 'android') {
      // iOS doesn't need this - AlarmKit handles it automatically
      return;
    }
    try {
      await NativeAlarmsModule.stopAlarmSoundAndDismiss?.(alarmId);
    } catch (error) {
      throw new AlarmError(
        AlarmErrorCode.SYSTEM_ERROR,
        'Failed to stop alarm sound and dismiss notification',
        error
      );
    }
  },

  /**
   * Get alarm by ID
   */
  async getAlarm(id: string): Promise<ScheduledAlarm | null> {
    try {
      const alarm = await NativeAlarmsModule.getAlarm(id);

      if (!alarm) return null;

      // Safely convert nextFireDate, handling invalid dates
      // For debugging purposes, use a fallback date instead of returning null
      let nextFireDate: Date;
      
      if (alarm.nextFireDate) {
        // Handle both string and number formats (Android returns string, but React Native might convert)
        const dateValue = typeof alarm.nextFireDate === 'string' 
          ? parseInt(alarm.nextFireDate, 10) 
          : alarm.nextFireDate;
        
        const date = new Date(dateValue);
        if (!isNaN(date.getTime())) {
          nextFireDate = date;
        } else {
          console.warn('[NativeAlarmModule] Invalid nextFireDate for alarm:', id, alarm.nextFireDate, 'using fallback date');
          // Use epoch as fallback so alarm still appears in debug screen
          nextFireDate = new Date(0);
        }
      } else {
        console.warn('[NativeAlarmModule] Missing nextFireDate for alarm:', id, 'using fallback date');
        // Use epoch as fallback so alarm still appears in debug screen
        nextFireDate = new Date(0);
      }
      
      return {
        ...alarm,
        nextFireDate,
      };
    } catch (error) {
      throw new AlarmError(
        AlarmErrorCode.SYSTEM_ERROR,
        'Failed to get alarm',
        error
      );
    }
  },

  /**
   * Get all scheduled alarms
   */
  async getAllAlarms(): Promise<ScheduledAlarm[]> {
    try {
      const alarms = await NativeAlarmsModule.getAllAlarms();

      return alarms.map(alarm => {
        // Safely convert nextFireDate, handling invalid dates
        // For debugging purposes, use a fallback date instead of filtering out alarms
        let nextFireDate: Date;
        
        if (alarm.nextFireDate) {
          // Handle both string and number formats (Android returns string, but React Native might convert)
          const dateValue = typeof alarm.nextFireDate === 'string' 
            ? parseInt(alarm.nextFireDate, 10) 
            : alarm.nextFireDate;
          
          const date = new Date(dateValue);
          if (!isNaN(date.getTime())) {
            nextFireDate = date;
          } else {
            console.warn('[NativeAlarmModule] Invalid nextFireDate for alarm:', alarm.id, alarm.nextFireDate, 'using fallback date');
            // Use epoch as fallback so alarm still appears in debug screen
            nextFireDate = new Date(0);
          }
        } else {
          console.warn('[NativeAlarmModule] Missing nextFireDate for alarm:', alarm.id, 'using fallback date');
          // Use epoch as fallback so alarm still appears in debug screen
          nextFireDate = new Date(0);
        }
        
        return {
          ...alarm,
          nextFireDate,
        };
      });
    } catch (error) {
      throw new AlarmError(
        AlarmErrorCode.SYSTEM_ERROR,
        'Failed to get alarms',
        error
      );
    }
  },

  /**
   * Get alarms by category
   */
  async getAlarmsByCategory(category: string): Promise<ScheduledAlarm[]> {
    try {
      const alarms = await NativeAlarmsModule.getAlarmsByCategory(category);

      return alarms.map(alarm => {
        // Safely convert nextFireDate, handling invalid dates
        // For debugging purposes, use a fallback date instead of filtering out alarms
        let nextFireDate: Date;
        
        if (alarm.nextFireDate) {
          // Handle both string and number formats (Android returns string, but React Native might convert)
          const dateValue = typeof alarm.nextFireDate === 'string' 
            ? parseInt(alarm.nextFireDate, 10) 
            : alarm.nextFireDate;
          
          const date = new Date(dateValue);
          if (!isNaN(date.getTime())) {
            nextFireDate = date;
          } else {
            console.warn('[NativeAlarmModule] Invalid nextFireDate for alarm:', alarm.id, alarm.nextFireDate, 'using fallback date');
            // Use epoch as fallback so alarm still appears in debug screen
            nextFireDate = new Date(0);
          }
        } else {
          console.warn('[NativeAlarmModule] Missing nextFireDate for alarm:', alarm.id, 'using fallback date');
          // Use epoch as fallback so alarm still appears in debug screen
          nextFireDate = new Date(0);
        }
        
        return {
          ...alarm,
          nextFireDate,
        };
      });
    } catch (error) {
      throw new AlarmError(
        AlarmErrorCode.SYSTEM_ERROR,
        'Failed to get alarms by category',
        error
      );
    }
  },

  /**
   * Snooze an alarm
   */
  async snoozeAlarm(id: string, minutes: number): Promise<void> {
    try {
      await NativeAlarmsModule.snoozeAlarm(id, minutes);
    } catch (error: any) {
      if (error.code === 'ALARM_NOT_FOUND') {
        throw new AlarmError(
          AlarmErrorCode.ALARM_NOT_FOUND,
          `Alarm with ID '${id}' not found`
        );
      }
      throw new AlarmError(
        AlarmErrorCode.SYSTEM_ERROR,
        'Failed to snooze alarm',
        error
      );
    }
  },

  /**
   * iOS-only: consume a pending deep link saved by AlarmKit intents.
   */
  async getPendingDeepLink(): Promise<string | null> {
    if (Platform.OS !== 'ios') {
      console.log('[NativeAlarmModule] getPendingDeepLink: Not iOS, returning null');
      return null;
    }
    try {
      // Not all builds will have this method; treat missing as no-op.
      if (typeof (NativeAlarmsModule as any).getPendingDeepLink !== 'function') {
        console.log('[NativeAlarmModule] getPendingDeepLink: Method not available');
        return null;
      }
      console.log('[NativeAlarmModule] getPendingDeepLink: Calling native method');
      const result = await (NativeAlarmsModule as any).getPendingDeepLink();
      console.log('[NativeAlarmModule] getPendingDeepLink: Native method returned:', result);
      return result;
    } catch (error) {
      console.error('[NativeAlarmModule] getPendingDeepLink: Error calling native method:', error);
      return null;
    }
  },

  /**
   * Subscribe to alarm fired events
   */
  onAlarmFired(callback: (event: AlarmFiredEvent) => void): () => void {
    if (!eventEmitter) {
      console.warn('[NativeAlarmModule] Event emitter not available, cannot subscribe to alarm fired events');
      return () => {}; // Return no-op unsubscribe function
    }
    
    const subscription = eventEmitter.addListener(
      EVENTS.ALARM_FIRED_EVENT,
      (event: any) => {
        // Convert date strings to Date objects
        callback({
          ...event,
          firedAt: new Date(event.firedAt),
          alarm: {
            ...event.alarm,
            nextFireDate: new Date(event.alarm.nextFireDate),
          },
        });
      }
    );

    return () => subscription.remove();
  },

  /**
   * Subscribe to permission changed events
   */
  onPermissionChanged(
    callback: (event: PermissionChangedEvent) => void
  ): () => void {
    if (!eventEmitter) {
      console.warn('[NativeAlarmModule] Event emitter not available, cannot subscribe to permission changed events');
      return () => {}; // Return no-op unsubscribe function
    }
    
    const subscription = eventEmitter.addListener(
      EVENTS.PERMISSION_CHANGED_EVENT,
      callback
    );

    return () => subscription.remove();
  },

  /**
   * Listen for native deep link requests (e.g. alarm dismissed).
   */
  onDeepLink(callback: (event: DeepLinkEvent) => void): () => void {
    if (!eventEmitter) {
      // Don't log warning - this is expected on Android where events aren't used
      // Android handles deep links via intent handling instead
      return () => {}; // Return no-op unsubscribe function
    }
    
    const sub = eventEmitter.addListener(
      (EVENTS as any).DEEP_LINK_EVENT || 'NotifierNativeAlarms_DeepLink',
      (payload: any) => {
        callback({
          url: String(payload?.url ?? ''),
          at: payload?.at ? String(payload.at) : undefined,
        });
      }
    );
    return () => sub.remove();
  },
};

export default NativeAlarmModule;
