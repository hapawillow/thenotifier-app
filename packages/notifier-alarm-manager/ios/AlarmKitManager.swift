import Foundation
import AlarmKit
import ActivityKit
import SwiftUI
import AppIntents
import OSLog

private let PENDING_ALARM_DEEPLINK_KEY = "thenotifier_pending_alarm_deeplink_url"
private let PENDING_ALARM_DEEPLINK_TIMESTAMP_KEY = "thenotifier_pending_alarm_deeplink_timestamp"
private let logger = Logger(subsystem: "com.thenotifier.alarmkit", category: "AlarmKitManager")

/// Live Activity intent used by AlarmKit to trigger the secondary (Snooze) action.
/// Defined in this file to ensure it is compiled into the existing CocoaPods target.
@available(iOS 26.0, *)
@available(macCatalyst, unavailable)
struct AlarmKitCountdownIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Snooze"

    @Parameter(title: "Alarm ID")
    var alarmID: String

    func perform() async throws -> some IntentResult {
        guard let uuid = UUID(uuidString: alarmID) else {
            return .result()
        }
        try AlarmManager.shared.countdown(id: uuid)
        return .result()
    }
}

/// Live Activity intent used by AlarmKit to trigger the stop/dismiss action (when applicable).
@available(iOS 26.0, *)
@available(macCatalyst, unavailable)
struct AlarmKitStopIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Stop"
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Alarm ID")
    var alarmID: String

    @Parameter(title: "Deep Link URL")
    var url: String?

    func perform() async throws -> some IntentResult {
        guard let uuid = UUID(uuidString: alarmID) else {
            logger.error("[AlarmKitStopIntent] Invalid alarm ID: \(alarmID, privacy: .public)")
            return .result()
        }
        
        logger.info("[AlarmKitStopIntent] perform() called for alarm: \(alarmID, privacy: .public), url parameter: \(url ?? "nil", privacy: .public)")
        
        // Get URL from parameter, or fallback to UserDefaults (stored when alarm was scheduled)
        var urlString = url
        
        // If URL parameter is nil/empty, try to get it from UserDefaults (stored when scheduling)
        if urlString == nil || urlString!.isEmpty {
            let storageKey = "\(PENDING_ALARM_DEEPLINK_KEY)_\(alarmID)"
            urlString = UserDefaults.standard.string(forKey: storageKey)
            if urlString == nil || urlString!.isEmpty {
                // Also check main key
                urlString = UserDefaults.standard.string(forKey: PENDING_ALARM_DEEPLINK_KEY)
            }
            logger.info("[AlarmKitStopIntent] Retrieved URL from UserDefaults: \(urlString ?? "nil")")
        }
        
        // Persist the deep link so JS can consume it on next app resume/launch.
        // Store in UserDefaults as fallback for when perform() isn't called (app launches from closed state).
        if let finalUrlString = urlString, !finalUrlString.isEmpty {
            logger.info("[AlarmKitStopIntent] Storing deep link URL in UserDefaults: \(finalUrlString, privacy: .public)")
            UserDefaults.standard.set(finalUrlString, forKey: PENDING_ALARM_DEEPLINK_KEY)
            // Store timestamp to validate freshness
            UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: PENDING_ALARM_DEEPLINK_TIMESTAMP_KEY)
            UserDefaults.standard.synchronize() // Force immediate write
            
            // Verify it was stored correctly
            let verifyUrl = UserDefaults.standard.string(forKey: PENDING_ALARM_DEEPLINK_KEY)
            if verifyUrl == finalUrlString {
                logger.info("[AlarmKitStopIntent] Deep link URL stored and verified successfully")
            } else {
                logger.error("[AlarmKitStopIntent] ERROR: URL storage verification failed! Stored: \(finalUrlString, privacy: .public), Retrieved: \(verifyUrl ?? "nil", privacy: .public)")
            }
            
            // Note: The monitorAlarms() function will detect the dismissal and call the delegate
            // to emit the deep link event to JS. We just store the URL here.
        } else {
            logger.warning("[AlarmKitStopIntent] WARNING: No URL available to store (parameter: \(url ?? "nil", privacy: .public), UserDefaults: \(UserDefaults.standard.string(forKey: PENDING_ALARM_DEEPLINK_KEY) ?? "nil", privacy: .public))")
        }

        // Best-effort stop (the system may already be dismissing UI).
        try? AlarmManager.shared.stop(id: uuid)
        logger.info("[AlarmKitStopIntent] perform() completed")
        return .result()
    }
}

// Metadata for alarms
@available(iOS 26.0, *)
nonisolated struct BasicAlarmMetadata: AlarmMetadata {
    // Empty metadata for basic alarms
}

@available(iOS 26.0, *)
class AlarmKitManager {

    weak var delegate: AlarmDelegate?
    private let manager = AlarmManager.shared
    private var alarmMetadataStore: [String: [String: Any]] = [:]
    private var lastPresentationModeByAlarmId: [String: String] = [:]
    private var currentAlarmIds: Set<String> = []
    private var currentAlarmsFromKit: [String: Alarm] = [:]

    init() {
        // Start monitoring alarms
        Task {
            await monitorAlarms()
        }
    }

    // MARK: - Authorization

    func checkAuthorization() async -> String {
        switch manager.authorizationState {
        case .notDetermined:
            return "notDetermined"
        case .authorized:
            return "authorized"
        case .denied:
            return "denied"
        @unknown default:
            return "notDetermined"
        }
    }

    func requestPermission() async throws -> Bool {
        let state = try await manager.requestAuthorization()
        return state == .authorized
    }

    // MARK: - Scheduling

    func scheduleAlarm(schedule: NSDictionary, config: NSDictionary) async throws -> [String: Any] {
        let alarmId = schedule["id"] as? String ?? UUID().uuidString
        let scheduleType = schedule["type"] as? String ?? "fixed"

        let attributes = buildAlarmAttributes(config: config)
        let uuid = UUID(uuidString: alarmId) ?? UUID()
        let canonicalAlarmId = uuid.uuidString

        // Serialize schedule to ensure date fields are numbers (not Date objects) before storing
        let serializedSchedule = serializeSchedule(schedule)
        
        // Store metadata using canonical UUID string (AlarmKit reports ids using uuidString which may differ in casing).
        alarmMetadataStore[canonicalAlarmId] = [
            "schedule": serializedSchedule,
            "config": config
        ]
        
        // Also persist metadata to UserDefaults so it survives app restarts
        // Serialize schedule first to ensure all date fields are numbers (property-list compatible)
        // Ensure config is also a proper NSDictionary (not a Swift Dictionary) for UserDefaults compatibility
        let metadataKey = "alarm_metadata_\(canonicalAlarmId)"
        let configDict = config as? NSDictionary ?? config as NSDictionary
        let metadataToStore: [String: Any] = [
            "schedule": serializedSchedule,
            "config": configDict
        ]
        
        // Log what we're storing for debugging
        let configKeys = configDict.allKeys.compactMap { $0 as? String }.joined(separator: ", ")
        let configTitle = configDict["title"] as? String ?? "nil"
        let configBody = configDict["body"] as? String ?? "nil"
        logger.info("[AlarmKitManager] Persisting metadata to UserDefaults for alarm: \(canonicalAlarmId, privacy: .public). Config keys: [\(configKeys, privacy: .public)], title: \(configTitle, privacy: .public), body: \(configBody, privacy: .public)")
        
        UserDefaults.standard.set(metadataToStore as NSDictionary, forKey: metadataKey)
        UserDefaults.standard.synchronize()
        
        // Verify it was stored correctly
        if let verifyMetadata = UserDefaults.standard.dictionary(forKey: metadataKey),
           let verifyConfig = verifyMetadata["config"] as? NSDictionary {
            let verifyKeys = verifyConfig.allKeys.compactMap { $0 as? String }.joined(separator: ", ")
            logger.info("[AlarmKitManager] Verified metadata storage for \(canonicalAlarmId, privacy: .public). Stored config keys: [\(verifyKeys, privacy: .public)]")
        } else {
            logger.error("[AlarmKitManager] ERROR: Failed to verify metadata storage for \(canonicalAlarmId)")
        }

        // AlarmKit supports true alarm scheduling via AlarmConfiguration.alarm(schedule:...)
        // Use alarm schedules for fixed/recurring to avoid timer limitations and ensure calendar dates are honored.
        let now = Date()
        let alarmSchedule = buildAlarmKitSchedule(schedule: schedule, now: now)

        // Build deep link to Notification Detail (scheme URL) using the strict data contract.
        let deepLinkUrlString: String? = buildDeepLinkUrlString(config: config)
        logger.info("[AlarmKitManager] Built deep link URL: \(deepLinkUrlString ?? "nil", privacy: .public)")
        
        // Store the deep link URL in UserDefaults NOW (when scheduling), so it's available even if
        // perform() isn't called when the app launches from a closed state.
        // We'll use the alarm ID as part of the key to support multiple alarms.
        if let urlString = deepLinkUrlString, !urlString.isEmpty {
            let storageKey = "\(PENDING_ALARM_DEEPLINK_KEY)_\(canonicalAlarmId)"
            logger.info("[AlarmKitManager] Storing deep link URL in UserDefaults (key: \(storageKey)): \(urlString)")
            UserDefaults.standard.set(urlString, forKey: storageKey)
            UserDefaults.standard.synchronize()
            // Note: We do NOT store in the main key during scheduling. The main key should only
            // be set when alarms are actually dismissed/fired, not when they're scheduled.
            // This prevents premature navigation when app comes to foreground.
            logger.info("[AlarmKitManager] Deep link URL stored successfully for alarm: \(canonicalAlarmId, privacy: .public)")
        } else {
            logger.warning("[AlarmKitManager] WARNING: Could not build deep link URL when scheduling alarm: \(canonicalAlarmId)")
        }

        // Build intents + countdownDuration for Snooze, if configured.
        // Important: `preAlert` affects behavior *before* the scheduled alert.
        // Setting `preAlert` to (e.g.) 10 minutes will prevent short-future alarms (like 2 minutes from now)
        // from ever reaching the alerting UI. For Snooze we want the duration after the user taps Snooze,
        // so we use `postAlert`.
        let snoozeSeconds = extractSnoozeSeconds(config: config)
        let countdownDuration: Alarm.CountdownDuration? = (snoozeSeconds != nil)
            ? Alarm.CountdownDuration(preAlert: nil, postAlert: snoozeSeconds)
            : nil

        var stopIntentValue = AlarmKitStopIntent()
        stopIntentValue.alarmID = uuid.uuidString
        stopIntentValue.url = deepLinkUrlString
        logger.info("[AlarmKitManager] Set stopIntent.url to: \(stopIntentValue.url ?? "nil", privacy: .public)")
        let stopIntent: (any LiveActivityIntent)? = stopIntentValue

        let secondaryIntent: (any LiveActivityIntent)? = {
            guard snoozeSeconds != nil else { return nil }
            var intent = AlarmKitCountdownIntent()
            intent.alarmID = uuid.uuidString
            return intent
        }()

        // Prompt requirement: alarms should use thenotifier.wav.
        // Use ActivityKit's AlertConfiguration.AlertSound.
        let sound = AlertConfiguration.AlertSound.named("thenotifier.wav")

        let alarm: Alarm
        if scheduleType == "interval" {
            // Interval countdown-style timers still use .timer
            let duration = calculateDuration(schedule: schedule)
            alarm = try await manager.schedule(
                id: uuid,
                configuration: .timer(
                    duration: duration,
                    attributes: attributes,
                    stopIntent: stopIntent,
                    secondaryIntent: secondaryIntent
                )
            )
        } else {
            // Use full initializer so we can pass countdownDuration + intents for Snooze.
            let alarmConfiguration = AlarmManager.AlarmConfiguration<BasicAlarmMetadata>(
                countdownDuration: countdownDuration,
                schedule: alarmSchedule,
                attributes: attributes,
                stopIntent: stopIntent,
                secondaryIntent: secondaryIntent,
                sound: sound
            )
            alarm = try await manager.schedule(
                id: uuid,
                configuration: alarmConfiguration
            )
        }

        let nextFireDate = resolveNextFireDateFromAlarmKitSchedule(schedule: alarmSchedule, now: now) ?? now

        // Schedule is already serialized above for persistence
        return [
            "id": canonicalAlarmId,
            "schedule": serializedSchedule,
            "config": config,
            "nextFireDate": ISO8601DateFormatter().string(from: nextFireDate),
            "capability": "native_alarms",
            "isActive": true,
            "platformAlarmId": canonicalAlarmId
        ]
    }

    func cancelAlarm(id: String) async throws {
        guard let uuid = UUID(uuidString: id) else {
            throw NSError(
                domain: "AlarmKitManager",
                code: 400,
                userInfo: [NSLocalizedDescriptionKey: "Invalid alarm ID"]
            )
        }

        let canonicalId = uuid.uuidString
        let lowerId = id.lowercased()
        let lowerCanonicalId = canonicalId.lowercased()

        // AlarmKit's cancel and stop are synchronous-throwing (not async)
        // Attempt cancel first (primary operation)
        do {
            try manager.cancel(id: uuid)
            logger.info("[AlarmKitManager] Successfully cancelled alarm in AlarmKit: \(canonicalId, privacy: .public)")
        } catch {
            // If cancel fails, still try stop as fallback
            logger.warning("[AlarmKitManager] cancel failed for \(canonicalId, privacy: .public), attempting stop: \(error)")
        }
        
        // Best-effort stop to dismiss alarms that might be in .alerting state
        do {
            try manager.stop(id: uuid)
        } catch {
            // Ignore stop errors - it's best-effort cleanup
            logger.info("[AlarmKitManager] stop failed for \(canonicalId, privacy: .public) (may not be alerting): \(error)")
        }
        
        // Remove from metadata store using case-insensitive matching
        // Check all keys and remove any that match (case-insensitive)
        var removedFromStore = false
        for (key, _) in alarmMetadataStore {
            if key.lowercased() == lowerCanonicalId || key.lowercased() == lowerId {
                alarmMetadataStore.removeValue(forKey: key)
                removedFromStore = true
                logger.info("[AlarmKitManager] Removed alarm from metadata store using key: \(key, privacy: .public)")
            }
        }
        if !removedFromStore {
            logger.info("[AlarmKitManager] Alarm \(canonicalId, privacy: .public) not found in metadata store (may have already been removed)")
        }
        
        // Clean up alarm-specific deep link key (try multiple ID formats)
        let storageKeys = [
            "\(PENDING_ALARM_DEEPLINK_KEY)_\(canonicalId)",
            "\(PENDING_ALARM_DEEPLINK_KEY)_\(id)"
        ]
        for storageKey in storageKeys {
            UserDefaults.standard.removeObject(forKey: storageKey)
        }
        
        // Also clean up persisted metadata (try multiple ID formats)
        let metadataKeys = [
            "alarm_metadata_\(canonicalId)",
            "alarm_metadata_\(id)"
        ]
        for metadataKey in metadataKeys {
            UserDefaults.standard.removeObject(forKey: metadataKey)
        }
        
        // Case-insensitive cleanup: search all UserDefaults keys for matching alarm IDs
        let defaults = UserDefaults.standard
        let allKeys = defaults.dictionaryRepresentation().keys
        for key in allKeys {
            // Check deep link keys
            if key.hasPrefix(PENDING_ALARM_DEEPLINK_KEY + "_") {
                let storedId = String(key.dropFirst((PENDING_ALARM_DEEPLINK_KEY + "_").count))
                if storedId.lowercased() == lowerCanonicalId || storedId.lowercased() == lowerId {
                    UserDefaults.standard.removeObject(forKey: key)
                    logger.info("[AlarmKitManager] Removed deep link key (case-insensitive match): \(key, privacy: .public)")
                }
            }
            // Check metadata keys
            if key.hasPrefix("alarm_metadata_") {
                let storedId = String(key.dropFirst("alarm_metadata_".count))
                if storedId.lowercased() == lowerCanonicalId || storedId.lowercased() == lowerId {
                    UserDefaults.standard.removeObject(forKey: key)
                    logger.info("[AlarmKitManager] Removed metadata key (case-insensitive match): \(key, privacy: .public)")
                }
            }
        }
        
        UserDefaults.standard.synchronize()
        logger.info("[AlarmKitManager] Cleaned up deep link keys and metadata for cancelled alarm: \(canonicalId, privacy: .public)")
    }

    func cancelAllAlarms() async throws {
        let alarms = try await getAllAlarms()

        for alarm in alarms {
            if let id = alarm["id"] as? String {
                try await cancelAlarm(id: id)
            }
        }
    }

    func cancelAlarmsByCategory(category: String) async throws {
        let alarms = try await getAlarmsByCategory(category: category)

        for alarm in alarms {
            if let id = alarm["id"] as? String {
                try await cancelAlarm(id: id)
            }
        }
    }

    // MARK: - Query

    func getAlarm(id: String) async throws -> [String: Any]? {
        let canonicalId = UUID(uuidString: id)?.uuidString ?? id
        guard let metadata = alarmMetadataStore[canonicalId] else {
            return nil
        }

        guard let schedule = metadata["schedule"] as? NSDictionary,
              let config = metadata["config"] as? NSDictionary else {
            return nil
        }

        let duration = calculateDuration(schedule: schedule)
        let nextFireDate = Date.now.addingTimeInterval(duration)

        // Serialize schedule to ensure date fields are numbers (not Date objects)
        let serializedSchedule = serializeSchedule(schedule)

        return [
            "id": canonicalId,
            "schedule": serializedSchedule,
            "config": config,
            "nextFireDate": ISO8601DateFormatter().string(from: nextFireDate),
            "capability": "native_alarms",
            "isActive": true,
            "platformAlarmId": canonicalId
        ]
    }

    func getAllAlarms() async throws -> [[String: Any]] {
        var alarms: [[String: Any]] = []
        var addedAlarmIds = Set<String>()
        
        // Use currentAlarmsFromKit (populated by monitorAlarms())
        // Note: If this is empty, monitorAlarms() hasn't received updates yet
        // In that case, we'll still process alarms from metadata store
        var alarmsFromKit = currentAlarmsFromKit
        logger.info("[AlarmKitManager] getAllAlarms() called. currentAlarmsFromKit count: \(alarmsFromKit.count), metadata store count: \(self.alarmMetadataStore.count)")
        
        // If currentAlarmsFromKit is empty, wait briefly for monitorAlarms() to populate it
        // This handles the case where getAllAlarms() is called before monitorAlarms() has received its first update
        if alarmsFromKit.isEmpty {
            logger.info("[AlarmKitManager] currentAlarmsFromKit is empty, waiting briefly for monitorAlarms() to populate")
            // Wait up to 500ms for monitorAlarms() to populate currentAlarmsFromKit
            for _ in 0..<5 {
                try? await Task.sleep(nanoseconds: 100_000_000) // 100ms
                alarmsFromKit = self.currentAlarmsFromKit
                if !alarmsFromKit.isEmpty {
                    logger.info("[AlarmKitManager] Got \(alarmsFromKit.count) alarms from monitorAlarms() after wait")
                    break
                }
            }
            if alarmsFromKit.isEmpty {
                logger.warning("[AlarmKitManager] Still empty after waiting, proceeding with metadata-only alarms")
            }
        }
        
        // Restore metadata from UserDefaults for ALL alarms that have persisted metadata
        // This handles alarms scheduled before app restart, even if they're not in currentAlarmsFromKit yet
        // Check all UserDefaults keys that start with "alarm_metadata_"
        let defaults = UserDefaults.standard
        let allKeys = defaults.dictionaryRepresentation().keys
        for key in allKeys {
            if key.hasPrefix("alarm_metadata_") {
                let alarmId = String(key.dropFirst("alarm_metadata_".count))
                let canonicalId = UUID(uuidString: alarmId)?.uuidString ?? alarmId
                
                // Check if already in memory store (case-insensitive)
                var alreadyRestored = false
                let lowerAlarmId = alarmId.lowercased()
                let lowerCanonicalId = canonicalId.lowercased()
                for (storedKey, _) in alarmMetadataStore {
                    if storedKey.lowercased() == lowerCanonicalId || storedKey.lowercased() == lowerAlarmId {
                        alreadyRestored = true
                        break
                    }
                }
                
                // If not already in memory store, restore it
                if !alreadyRestored {
                    if let restoredMetadata = defaults.dictionary(forKey: key) {
                        // Verify config is present and is a dictionary
                        if let config = restoredMetadata["config"] as? NSDictionary {
                            let configKeys = config.allKeys.compactMap { $0 as? String }.joined(separator: ", ")
                            logger.info("[AlarmKitManager] Restored metadata from UserDefaults during initial scan: \(key, privacy: .public) -> \(canonicalId, privacy: .public). Config keys: [\(configKeys, privacy: .public)]")
                        } else {
                            logger.warning("[AlarmKitManager] Restored metadata for \(canonicalId) but config is missing or not a dictionary. Config type: \(type(of: restoredMetadata["config"] ?? NSNull()))")
                        }
                        alarmMetadataStore[canonicalId] = restoredMetadata
                    }
                }
            }
        }
        
        // Also restore metadata for alarms currently in AlarmKit (with case-insensitive matching)
        for (alarmId, _) in alarmsFromKit {
            let canonicalId = UUID(uuidString: alarmId)?.uuidString ?? alarmId
            let lowerAlarmId = alarmId.lowercased()
            let lowerCanonicalId = canonicalId.lowercased()
            
            // Check if already in memory store (case-insensitive)
            var alreadyRestored = false
            for (storedKey, _) in alarmMetadataStore {
                if storedKey.lowercased() == lowerCanonicalId || storedKey.lowercased() == lowerAlarmId {
                    alreadyRestored = true
                    break
                }
            }
            
            // If not in memory store, try to restore from UserDefaults
            if !alreadyRestored {
                let metadataKey = "alarm_metadata_\(canonicalId)"
                if let restoredMetadata = defaults.dictionary(forKey: metadataKey) {
                    alarmMetadataStore[canonicalId] = restoredMetadata
                    logger.info("[AlarmKitManager] Restored metadata for AlarmKit alarm \(canonicalId, privacy: .public) using canonical ID")
                } else {
                    // Try with original ID too
                    let metadataKey2 = "alarm_metadata_\(alarmId)"
                    if let restoredMetadata = defaults.dictionary(forKey: metadataKey2) {
                        alarmMetadataStore[canonicalId] = restoredMetadata
                        logger.info("[AlarmKitManager] Restored metadata for AlarmKit alarm \(canonicalId) using original ID")
                    } else {
                        // Try case-insensitive search in UserDefaults
                        for key in allKeys {
                            if key.hasPrefix("alarm_metadata_") {
                                let storedId = String(key.dropFirst("alarm_metadata_".count))
                                if storedId.lowercased() == lowerCanonicalId || storedId.lowercased() == lowerAlarmId {
                                    if let restoredMetadata = defaults.dictionary(forKey: key) {
                                        alarmMetadataStore[canonicalId] = restoredMetadata
                                        logger.info("[AlarmKitManager] Restored metadata for AlarmKit alarm \(canonicalId, privacy: .public) using case-insensitive match: \(key, privacy: .public)")
                                        break
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // Process alarms from metadata store first (these have full information)
        // Include ALL alarms from metadata store, even if they're not in alarmsFromKit yet
        for (storedId, metadata) in alarmMetadataStore {
            guard let schedule = metadata["schedule"] as? NSDictionary,
                  let config = metadata["config"] as? NSDictionary else {
                logger.warning("[AlarmKitManager] Skipping alarm \(storedId, privacy: .public) in metadata store - missing schedule or config. Metadata keys: \(Array(metadata.keys).joined(separator: ", "), privacy: .public)")
                continue
            }
            
            logger.info("[AlarmKitManager] Processing alarm from metadata store: \(storedId, privacy: .public)")
            
            // Check if config has title/body - if not, try to extract from deep link URL
            var finalConfig = config
            let configTitle = config["title"] as? String
            let configBody = config["body"] as? String ?? config["message"] as? String
            
            if configTitle == nil || configTitle!.isEmpty || configBody == nil || configBody!.isEmpty {
                logger.warning("[AlarmKitManager] Alarm \(storedId, privacy: .public) config missing title/body, attempting to extract from deep link URL")
                
                // Try to extract from deep link URL
                let storageKey = "\(PENDING_ALARM_DEEPLINK_KEY)_\(storedId)"
                var deepLinkUrl = UserDefaults.standard.string(forKey: storageKey)
                
                // Try case-insensitive search
                if deepLinkUrl == nil || deepLinkUrl!.isEmpty {
                    let defaults = UserDefaults.standard
                    let allKeys = defaults.dictionaryRepresentation().keys
                    for key in allKeys {
                        if key.hasPrefix(PENDING_ALARM_DEEPLINK_KEY + "_") {
                            let storedIdFromKey = String(key.dropFirst((PENDING_ALARM_DEEPLINK_KEY + "_").count))
                            if storedIdFromKey.lowercased() == storedId.lowercased() {
                                deepLinkUrl = defaults.string(forKey: key)
                                if deepLinkUrl != nil && !deepLinkUrl!.isEmpty {
                                    break
                                }
                            }
                        }
                    }
                }
                
                // Parse deep link URL if found
                if let urlString = deepLinkUrl, !urlString.isEmpty,
                   let url = URL(string: urlString),
                   let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
                   let queryItems = components.queryItems {
                    var extractedTitle = configTitle
                    var extractedBody = configBody
                    
                    for item in queryItems {
                        if item.name == "title", let value = item.value, !value.isEmpty {
                            extractedTitle = value
                        } else if item.name == "message", let value = item.value, !value.isEmpty {
                            extractedBody = value
                        }
                    }
                    
                    // Create a new config dictionary with extracted values
                    if extractedTitle != nil || extractedBody != nil {
                        let mutableConfig = NSMutableDictionary(dictionary: config)
                        if let title = extractedTitle, !title.isEmpty {
                            mutableConfig["title"] = title
                        }
                        if let body = extractedBody, !body.isEmpty {
                            mutableConfig["body"] = body
                        }
                        finalConfig = mutableConfig
                            logger.info("[AlarmKitManager] Fixed config for alarm \(storedId, privacy: .public) using deep link URL. Title: \(extractedTitle ?? "nil", privacy: .public), Body: \(extractedBody ?? "nil", privacy: .public)")
                    }
                }
            }
            
            let serializedSchedule = serializeSchedule(schedule)
            
            // Try to get next fire date from AlarmKit Alarm object if available
            // This is more accurate than calculateDuration() and handles edge cases
            var nextFireDate: Date
            var alarmKitAlarm: Alarm? = alarmsFromKit[storedId]
            
            // Try case-insensitive lookup if direct lookup failed
            if alarmKitAlarm == nil {
                for (key, alarm) in alarmsFromKit {
                    if key.lowercased() == storedId.lowercased() {
                        alarmKitAlarm = alarm
                        break
                    }
                }
            }
            
            if let kitAlarm = alarmKitAlarm {
                // Use AlarmKit's schedule to get accurate next fire date
                if let kitFireDate = resolveNextFireDateFromAlarmKitSchedule(schedule: kitAlarm.schedule, now: Date.now) {
                    // Validate the date is not epoch
                    if kitFireDate.timeIntervalSince1970 > 0 {
                        nextFireDate = kitFireDate
                    } else {
                        // Invalid date, fallback to calculateDuration
                        let duration = calculateDuration(schedule: schedule)
                        let calculatedDate = Date.now.addingTimeInterval(duration)
                        nextFireDate = (calculatedDate.timeIntervalSince1970 > 0 && calculatedDate > Date.now) 
                            ? calculatedDate 
                            : Date.now.addingTimeInterval(3600)
                    }
                } else {
                    // resolveNextFireDateFromAlarmKitSchedule returned nil, use calculateDuration
                    let duration = calculateDuration(schedule: schedule)
                    let calculatedDate = Date.now.addingTimeInterval(duration)
                    // Ensure date is valid and in the future
                    if calculatedDate.timeIntervalSince1970 > 0 && calculatedDate > Date.now {
                        nextFireDate = calculatedDate
                    } else {
                        // If calculation failed, use a safe fallback (1 hour from now)
                        nextFireDate = Date.now.addingTimeInterval(3600)
                    }
                }
            } else {
                // No AlarmKit alarm found, use calculateDuration
                let duration = calculateDuration(schedule: schedule)
                let calculatedDate = Date.now.addingTimeInterval(duration)
                // Ensure date is valid and in the future
                if calculatedDate.timeIntervalSince1970 > 0 && calculatedDate > Date.now {
                    nextFireDate = calculatedDate
                } else {
                    // If calculation failed, use a safe fallback (1 hour from now)
                    nextFireDate = Date.now.addingTimeInterval(3600)
                }
            }
            
            let alarmDict: [String: Any] = [
                "id": storedId,
                "schedule": serializedSchedule,
                "config": finalConfig,
                "nextFireDate": ISO8601DateFormatter().string(from: nextFireDate),
                "capability": "native_alarms",
                "isActive": true,
                "platformAlarmId": storedId
            ]
            addedAlarmIds.insert(storedId)
            addedAlarmIds.insert(storedId.lowercased())
            alarms.append(alarmDict)
        }
        
        // Then process alarms from AlarmKit that aren't in metadata store
        logger.info("[AlarmKitManager] Processing \(alarmsFromKit.count) alarms from AlarmKit")
        for (alarmId, alarmKitAlarm) in alarmsFromKit {
            let canonicalId = UUID(uuidString: alarmId)?.uuidString ?? alarmId
            
            // Skip if already added (case-insensitive check)
            let lowerAlarmId = alarmId.lowercased()
            let lowerCanonicalId = canonicalId.lowercased()
            if addedAlarmIds.contains(alarmId) || addedAlarmIds.contains(canonicalId) ||
               addedAlarmIds.contains(lowerAlarmId) || addedAlarmIds.contains(lowerCanonicalId) {
                logger.info("[AlarmKitManager] Skipping alarm \(canonicalId, privacy: .public) - already added from metadata")
                continue
            }
            
            logger.info("[AlarmKitManager] Processing alarm from AlarmKit: \(canonicalId, privacy: .public)")
            
            // Try to find metadata (case-insensitive lookup)
            var foundMetadata: [String: Any]? = nil
            for (key, value) in alarmMetadataStore {
                let lowerKey = key.lowercased()
                if lowerKey == lowerCanonicalId || lowerKey == lowerAlarmId {
                    foundMetadata = value
                    logger.info("[AlarmKitManager] Found metadata for alarm \(canonicalId, privacy: .public) using key: \(key, privacy: .public)")
                    break
                }
            }
            
            // If not found in memory store, try to restore from UserDefaults with various ID formats
            if foundMetadata == nil {
                // Try canonical ID first
                let metadataKey = "alarm_metadata_\(canonicalId)"
                if let restoredMetadata = UserDefaults.standard.dictionary(forKey: metadataKey) {
                    foundMetadata = restoredMetadata
                    alarmMetadataStore[canonicalId] = restoredMetadata
                    logger.info("[AlarmKitManager] Restored metadata from UserDefaults for alarm \(canonicalId) using key: \(metadataKey)")
                } else {
                    // Try original ID
                    let metadataKey2 = "alarm_metadata_\(alarmId)"
                    if let restoredMetadata = UserDefaults.standard.dictionary(forKey: metadataKey2) {
                        foundMetadata = restoredMetadata
                        alarmMetadataStore[canonicalId] = restoredMetadata
                        logger.info("[AlarmKitManager] Restored metadata from UserDefaults for alarm \(canonicalId, privacy: .public) using key: \(metadataKey2, privacy: .public)")
                    } else {
                        // Try case-insensitive search in UserDefaults
                        let defaults = UserDefaults.standard
                        let allKeys = defaults.dictionaryRepresentation().keys
                        for key in allKeys {
                            if key.hasPrefix("alarm_metadata_") {
                                let storedId = String(key.dropFirst("alarm_metadata_".count))
                                if storedId.lowercased() == lowerCanonicalId || storedId.lowercased() == lowerAlarmId {
                                    if let restoredMetadata = defaults.dictionary(forKey: key) {
                                        foundMetadata = restoredMetadata
                                        alarmMetadataStore[canonicalId] = restoredMetadata
                                        logger.info("[AlarmKitManager] Restored metadata from UserDefaults for alarm \(canonicalId, privacy: .public) using case-insensitive match: \(key, privacy: .public)")
                                        break
                                    }
                                }
                            }
                        }
                    }
                }
            }
            
            if foundMetadata == nil {
                let availableKeys = Array(alarmMetadataStore.keys).joined(separator: ", ")
                logger.warning("[AlarmKitManager] No metadata found for alarm \(canonicalId, privacy: .public) (original ID: \(alarmId, privacy: .public)). Available metadata keys: \(availableKeys, privacy: .public)")
            }
            
            // Get next fire date from AlarmKit Alarm object (most accurate)
            let nextFireDate: Date
            if let kitFireDate = resolveNextFireDateFromAlarmKitSchedule(schedule: alarmKitAlarm.schedule, now: Date.now) {
                // Ensure date is valid (not epoch) and in the future
                let now = Date.now
                if kitFireDate.timeIntervalSince1970 > 0 && kitFireDate > now {
                    nextFireDate = kitFireDate
                } else if kitFireDate.timeIntervalSince1970 > 0 {
                    // Date is valid but in the past, use it anyway (might be a recurring alarm)
                    nextFireDate = kitFireDate
                } else {
                    // Invalid date (epoch), use safe fallback
                    nextFireDate = now.addingTimeInterval(3600)
                }
            } else {
                // resolveNextFireDateFromAlarmKitSchedule returned nil
                // Try to extract date from the schedule directly
                switch alarmKitAlarm.schedule {
                case .fixed(let date):
                    // Use the fixed date directly
                    if date.timeIntervalSince1970 > 0 {
                        nextFireDate = date
                    } else {
                        nextFireDate = Date.now.addingTimeInterval(3600)
                    }
                case .relative(let rel):
                    // Calculate next occurrence from relative schedule
                    let hour = rel.time.hour
                    let minute = rel.time.minute
                    var calendar = Calendar.current
                    calendar.timeZone = TimeZone.current
                    let now = Date.now
                    
                    var components = calendar.dateComponents([.year, .month, .day], from: now)
                    components.hour = hour
                    components.minute = minute
                    components.second = 0
                    
                    if let baseDate = calendar.date(from: components) {
                        if baseDate > now {
                            nextFireDate = baseDate
                        } else {
                            // Time has passed today, use tomorrow
                            if let tomorrow = calendar.date(byAdding: .day, value: 1, to: baseDate) {
                                nextFireDate = tomorrow
                            } else {
                                nextFireDate = now.addingTimeInterval(3600)
                            }
                        }
                    } else {
                        nextFireDate = now.addingTimeInterval(3600)
                    }
                @unknown default:
                    nextFireDate = Date.now.addingTimeInterval(3600)
                }
            }
            
            // If we have complete metadata (both schedule and config), check if config has title/body
            if let metadata = foundMetadata,
               let schedule = metadata["schedule"] as? NSDictionary,
               let config = metadata["config"] as? NSDictionary {
                // Log config contents for debugging
                let configKeys = config.allKeys.compactMap { $0 as? String }.joined(separator: ", ")
                let configTitle = config["title"] as? String
                let configBody = config["body"] as? String ?? config["message"] as? String
                logger.info("[AlarmKitManager] Alarm \(canonicalId) has metadata. Config keys: [\(configKeys)], title: \(configTitle ?? "nil"), body: \(configBody ?? "nil")")
                
                // Check if config has title and body - if not, try to extract from deep link URL
                var finalConfig = config
                var needsConfigFix = false
                
                if configTitle == nil || configTitle!.isEmpty || configBody == nil || configBody!.isEmpty {
                    logger.warning("[AlarmKitManager] Alarm \(canonicalId, privacy: .public) config missing title/body, attempting to extract from deep link URL")
                    needsConfigFix = true
                    
                    // Try to extract from deep link URL
                    let storageKey = "\(PENDING_ALARM_DEEPLINK_KEY)_\(canonicalId)"
                    var deepLinkUrl = UserDefaults.standard.string(forKey: storageKey)
                    
                    // Try with original ID if canonical ID didn't work
                    if deepLinkUrl == nil || deepLinkUrl!.isEmpty {
                        let storageKey2 = "\(PENDING_ALARM_DEEPLINK_KEY)_\(alarmId)"
                        deepLinkUrl = UserDefaults.standard.string(forKey: storageKey2)
                    }
                    
                    // Try case-insensitive search
                    if deepLinkUrl == nil || deepLinkUrl!.isEmpty {
                        let defaults = UserDefaults.standard
                        let allKeys = defaults.dictionaryRepresentation().keys
                        for key in allKeys {
                            if key.hasPrefix(PENDING_ALARM_DEEPLINK_KEY + "_") {
                                let storedId = String(key.dropFirst((PENDING_ALARM_DEEPLINK_KEY + "_").count))
                                if storedId.lowercased() == lowerCanonicalId || storedId.lowercased() == lowerAlarmId {
                                    deepLinkUrl = defaults.string(forKey: key)
                                    if deepLinkUrl != nil && !deepLinkUrl!.isEmpty {
                                        break
                                    }
                                }
                            }
                        }
                    }
                    
                    // Parse deep link URL if found
                    if let urlString = deepLinkUrl, !urlString.isEmpty,
                       let url = URL(string: urlString),
                       let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
                       let queryItems = components.queryItems {
                        var extractedTitle = configTitle
                        var extractedBody = configBody
                        
                        for item in queryItems {
                            if item.name == "title", let value = item.value, !value.isEmpty {
                                extractedTitle = value
                            } else if item.name == "message", let value = item.value, !value.isEmpty {
                                extractedBody = value
                            }
                        }
                        
                        // Create a new config dictionary with extracted values
                        if extractedTitle != nil || extractedBody != nil {
                            let mutableConfig = NSMutableDictionary(dictionary: config)
                            if let title = extractedTitle, !title.isEmpty {
                                mutableConfig["title"] = title
                            }
                            if let body = extractedBody, !body.isEmpty {
                                mutableConfig["body"] = body
                            }
                            finalConfig = mutableConfig
                            logger.info("[AlarmKitManager] Fixed config for alarm \(canonicalId, privacy: .public) using deep link URL. Title: \(extractedTitle ?? "nil", privacy: .public), Body: \(extractedBody ?? "nil", privacy: .public)")
                        }
                    }
                }
                
                // Build alarm with metadata (potentially fixed config)
                let serializedSchedule = serializeSchedule(schedule)
                
                let alarmDict: [String: Any] = [
                    "id": canonicalId,
                    "schedule": serializedSchedule,
                    "config": finalConfig,
                    "nextFireDate": ISO8601DateFormatter().string(from: nextFireDate),
                    "capability": "native_alarms",
                    "isActive": true,
                    "platformAlarmId": canonicalId
                ]
                addedAlarmIds.insert(canonicalId)
                addedAlarmIds.insert(canonicalId.lowercased())
                alarms.append(alarmDict)
                continue // Skip to next alarm
            }
            
            // Log what we found in metadata for debugging
            if let metadata = foundMetadata {
                let metadataKeys = Array(metadata.keys).joined(separator: ", ")
                let hasSchedule = metadata["schedule"] != nil
                let hasConfig = metadata["config"] != nil
                let configType = type(of: metadata["config"] ?? NSNull())
                logger.warning("[AlarmKitManager] Alarm \(canonicalId, privacy: .public) metadata incomplete. Keys: [\(metadataKeys, privacy: .public)], hasSchedule: \(hasSchedule), hasConfig: \(hasConfig), configType: \(String(describing: configType))")
                
                // Try to inspect config even if it's not NSDictionary
                if let config = metadata["config"] {
                    let configDescription = String(describing: config)
                    logger.warning("[AlarmKitManager] Config value for \(canonicalId, privacy: .public): \(configDescription, privacy: .public)")
                }
            }
            
            // Partial metadata or no metadata - extract what we can
            var title = "Alarm (metadata unavailable)"
            var body = "Scheduled before app restart"
            var scheduleDict: NSDictionary? = nil
            var configDict: NSDictionary? = nil
            
            if let metadata = foundMetadata {
                // Try to extract config from metadata first
                if let config = metadata["config"] as? NSDictionary {
                    configDict = config
                    // Extract title and body from config if available
                    if let configTitle = config["title"] as? String, !configTitle.isEmpty {
                        title = configTitle
                    }
                    if let configBody = config["body"] as? String, !configBody.isEmpty {
                        body = configBody
                    } else if let configMessage = config["message"] as? String, !configMessage.isEmpty {
                        body = configMessage
                    }
                }
                
                // Extract schedule from metadata
                if let schedule = metadata["schedule"] as? NSDictionary {
                    scheduleDict = schedule
                }
            }
            
            // If title/body still not found, try to extract from deep link URL
            if title == "Alarm (metadata unavailable)" || body == "Scheduled before app restart" {
                let storageKey = "\(PENDING_ALARM_DEEPLINK_KEY)_\(canonicalId)"
                var deepLinkUrl = UserDefaults.standard.string(forKey: storageKey)
                var foundKey = storageKey
                
                // Try with original ID if canonical ID didn't work
                if deepLinkUrl == nil || deepLinkUrl!.isEmpty {
                    let storageKey2 = "\(PENDING_ALARM_DEEPLINK_KEY)_\(alarmId)"
                    deepLinkUrl = UserDefaults.standard.string(forKey: storageKey2)
                    if deepLinkUrl != nil && !deepLinkUrl!.isEmpty {
                        foundKey = storageKey2
                        logger.info("[AlarmKitManager] Found deep link URL for alarm \(canonicalId, privacy: .public) using original ID key: \(storageKey2, privacy: .public)")
                    }
                } else {
                    logger.info("[AlarmKitManager] Found deep link URL for alarm \(canonicalId, privacy: .public) using canonical ID key: \(storageKey, privacy: .public)")
                }
                
                // Try case-insensitive search in UserDefaults if still not found
                if deepLinkUrl == nil || deepLinkUrl!.isEmpty {
                    let defaults = UserDefaults.standard
                    let allKeys = defaults.dictionaryRepresentation().keys
                    for key in allKeys {
                        if key.hasPrefix(PENDING_ALARM_DEEPLINK_KEY + "_") {
                            let storedId = String(key.dropFirst((PENDING_ALARM_DEEPLINK_KEY + "_").count))
                            if storedId.lowercased() == lowerCanonicalId || storedId.lowercased() == lowerAlarmId {
                                deepLinkUrl = defaults.string(forKey: key)
                                if deepLinkUrl != nil && !deepLinkUrl!.isEmpty {
                                    foundKey = key
                                    logger.info("[AlarmKitManager] Found deep link URL for alarm \(canonicalId, privacy: .public) using case-insensitive match: \(key, privacy: .public)")
                                    break
                                }
                            }
                        }
                    }
                }
                
                // Also try searching by partial UUID match (in case IDs differ slightly)
                if deepLinkUrl == nil || deepLinkUrl!.isEmpty {
                    let defaults = UserDefaults.standard
                    let allKeys = defaults.dictionaryRepresentation().keys
                    // Extract last 8 characters of UUID for matching (more lenient)
                    let canonicalIdSuffix = String(canonicalId.suffix(8)).lowercased()
                    let alarmIdSuffix = String(alarmId.suffix(8)).lowercased()
                    
                    for key in allKeys {
                        if key.hasPrefix(PENDING_ALARM_DEEPLINK_KEY + "_") {
                            let storedId = String(key.dropFirst((PENDING_ALARM_DEEPLINK_KEY + "_").count))
                            let storedIdSuffix = String(storedId.suffix(8)).lowercased()
                            if storedIdSuffix == canonicalIdSuffix || storedIdSuffix == alarmIdSuffix {
                                deepLinkUrl = defaults.string(forKey: key)
                                if deepLinkUrl != nil && !deepLinkUrl!.isEmpty {
                                    foundKey = key
                                    logger.info("[AlarmKitManager] Found deep link URL for alarm \(canonicalId, privacy: .public) using UUID suffix match: \(key, privacy: .public)")
                                    break
                                }
                            }
                        }
                    }
                }
                
                // Parse deep link URL if found
                if let urlString = deepLinkUrl, !urlString.isEmpty,
                   let url = URL(string: urlString),
                   let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
                   let queryItems = components.queryItems {
                    // Extract title and message from deep link query parameters
                    for item in queryItems {
                        if item.name == "title", let value = item.value, !value.isEmpty {
                            title = value
                            logger.info("[AlarmKitManager] Extracted title from deep link: \(title, privacy: .public)")
                        } else if item.name == "message", let value = item.value, !value.isEmpty {
                            body = value
                            logger.info("[AlarmKitManager] Extracted body from deep link: \(body, privacy: .public)")
                        }
                    }
                } else if deepLinkUrl == nil || deepLinkUrl!.isEmpty {
                    // Log all available deep link keys for debugging
                    let defaults = UserDefaults.standard
                    let allKeys = defaults.dictionaryRepresentation().keys
                    var foundDeepLinkKeys: [String] = []
                    for key in allKeys {
                        if key.hasPrefix(PENDING_ALARM_DEEPLINK_KEY + "_") {
                            foundDeepLinkKeys.append(key)
                        }
                    }
                    logger.warning("[AlarmKitManager] No deep link URL found for alarm \(canonicalId, privacy: .public) (canonical: \(canonicalId, privacy: .public), original: \(alarmId, privacy: .public)). Tried keys: \(storageKey, privacy: .public), \(PENDING_ALARM_DEEPLINK_KEY)_\(alarmId, privacy: .public). All available deep link keys: \(foundDeepLinkKeys.joined(separator: ", "), privacy: .public)")
                }
            }
            
            // Use schedule from metadata if available, otherwise build from AlarmKit
            let finalScheduleDict: NSDictionary
            if let schedule = scheduleDict {
                finalScheduleDict = serializeSchedule(schedule)
            } else {
                // Build a basic schedule dictionary from AlarmKit's schedule
                switch alarmKitAlarm.schedule {
                case .fixed(let date):
                    finalScheduleDict = [
                        "type": "fixed",
                        "date": date.timeIntervalSince1970 * 1000.0 // milliseconds
                    ] as NSDictionary
                case .relative(let rel):
                    let timeDict: NSDictionary = [
                        "hour": rel.time.hour,
                        "minute": rel.time.minute
                    ]
                    var dict: [String: Any] = [
                        "type": "recurring",
                        "time": timeDict
                    ]
                    
                    switch rel.repeats {
                    case .weekly(let weekdays):
                        dict["repeatInterval"] = "weekly"
                        dict["daysOfWeek"] = weekdays.map { weekday in
                            switch weekday {
                            case .sunday: return 0
                            case .monday: return 1
                            case .tuesday: return 2
                            case .wednesday: return 3
                            case .thursday: return 4
                            case .friday: return 5
                            case .saturday: return 6
                            @unknown default: return -1
                            }
                        }
                    case .never:
                        dict["repeatInterval"] = "never"
                    @unknown default:
                        dict["repeatInterval"] = "unknown"
                    }
                    finalScheduleDict = dict as NSDictionary
                @unknown default:
                    finalScheduleDict = ["type": "unknown"] as NSDictionary
                }
            }
            
            // Use config from metadata if available, but merge in extracted title/body if they were found
            let finalConfigDict: NSDictionary
            if let config = configDict {
                // If we extracted title/body from deep link URL, merge them into the config
                if title != "Alarm (metadata unavailable)" && body != "Scheduled before app restart" {
                    let mutableConfig = NSMutableDictionary(dictionary: config)
                    mutableConfig["title"] = title
                    mutableConfig["body"] = body
                    finalConfigDict = mutableConfig
                    logger.info("[AlarmKitManager] Merged extracted title/body into config for alarm \(canonicalId, privacy: .public). Title: \(title, privacy: .public), Body: \(body, privacy: .public)")
                } else {
                    finalConfigDict = config
                }
            } else {
                finalConfigDict = [
                    "title": title,
                    "body": body
                ] as NSDictionary
            }
            
            // Log final config for debugging
            let finalConfigTitle = (finalConfigDict["title"] as? String) ?? "nil"
            let finalConfigBody = (finalConfigDict["body"] as? String) ?? "nil"
            logger.info("[AlarmKitManager] Final config for alarm \(canonicalId, privacy: .public): title=\(finalConfigTitle, privacy: .public), body=\(finalConfigBody, privacy: .public)")
            
            let alarmDict: [String: Any] = [
                "id": canonicalId,
                "schedule": finalScheduleDict,
                "config": finalConfigDict,
                "nextFireDate": ISO8601DateFormatter().string(from: nextFireDate),
                "capability": "native_alarms",
                "isActive": true,
                "platformAlarmId": canonicalId
            ]
            addedAlarmIds.insert(canonicalId)
            addedAlarmIds.insert(canonicalId.lowercased())
            alarms.append(alarmDict)
            
            if foundMetadata == nil {
                // Log when metadata is missing to help debug
                logger.warning("[AlarmKitManager] Alarm \(canonicalId, privacy: .public) missing metadata, using fallback extraction")
            }
        }
        
        let returnedIds = alarms.compactMap { $0["id"] as? String }
        logger.info("[AlarmKitManager] getAllAlarms() returning \(alarms.count) alarms. Alarm IDs: \(returnedIds.joined(separator: ", "), privacy: .public)")
        
        // Log summary: how many from metadata vs AlarmKit
        let fromMetadataCount = returnedIds.filter { id in
            self.alarmMetadataStore.keys.contains { $0.lowercased() == id.lowercased() }
        }.count
        logger.info("[AlarmKitManager] Summary: \(fromMetadataCount) from metadata, \(alarms.count - fromMetadataCount) from AlarmKit only")
        
        return alarms
    }

    func getAlarmsByCategory(category: String) async throws -> [[String: Any]] {
        var alarms: [[String: Any]] = []

        for (id, metadata) in alarmMetadataStore {
            guard let config = metadata["config"] as? NSDictionary,
                  let alarmCategory = config["category"] as? String,
                  alarmCategory == category else {
                continue
            }

            if let alarm = try await getAlarm(id: id) {
                alarms.append(alarm)
            }
        }

        return alarms
    }

    // MARK: - Actions

    func snoozeAlarm(id: String, minutes: Int) async throws {
        // For snooze, cancel existing and reschedule
        let canonicalId = UUID(uuidString: id)?.uuidString ?? id
        guard let metadata = alarmMetadataStore[canonicalId],
              let schedule = metadata["schedule"] as? NSDictionary,
              let config = metadata["config"] as? NSDictionary else {
            throw NSError(
                domain: "AlarmKitManager",
                code: 404,
                userInfo: [NSLocalizedDescriptionKey: "Alarm not found"]
            )
        }

        try await cancelAlarm(id: canonicalId)

        // Determine snooze duration: prefer from action config, fallback to parameter, then default
        var snoozeMinutes = minutes
        if let actions = config["actions"] as? [[String: Any]] {
            for action in actions {
                if let behavior = action["behavior"] as? String, behavior == "snooze" {
                    if let duration = action["snoozeDuration"] as? Int {
                        snoozeMinutes = duration
                        break
                    }
                }
            }
        }
        
        // Fallback to 10 minutes if no valid duration found
        if snoozeMinutes <= 0 {
            snoozeMinutes = 10
        }

        // Reschedule with snooze delay
        let snoozeDuration = TimeInterval(snoozeMinutes * 60)
        let attributes = buildAlarmAttributes(config: config)

        let uuid = UUID(uuidString: canonicalId) ?? UUID()
        var stopIntentForSnooze = AlarmKitStopIntent()
        stopIntentForSnooze.alarmID = uuid.uuidString
        _ = try await manager.schedule(
            id: uuid,
            configuration: .timer(
                duration: snoozeDuration,
                attributes: attributes,
                stopIntent: stopIntentForSnooze,
                secondaryIntent: {
                    var intent = AlarmKitCountdownIntent()
                    intent.alarmID = uuid.uuidString
                    return intent
                }()
            )
        )

        // Restore metadata
        alarmMetadataStore[canonicalId] = metadata
    }

    // MARK: - Helper Methods

    /// Map JS weekday (0=Sunday..6=Saturday) to Foundation.Locale.Weekday
    private func mapToLocaleWeekday(_ day: Int) -> Foundation.Locale.Weekday? {
        switch day {
        case 0: return .sunday
        case 1: return .monday
        case 2: return .tuesday
        case 3: return .wednesday
        case 4: return .thursday
        case 5: return .friday
        case 6: return .saturday
        default: return nil
        }
    }

    /// Build an AlarmKit Alarm.Schedule from our JS schedule dictionary.
    /// - For fixed alarms: prefer schedule.date; otherwise compute next occurrence from time.
    /// - For weekly recurring: use AlarmKit's relative weekly recurrence.
    /// - For other recurring: schedule the next occurrence as a fixed date; monitorAlarms will reschedule after fire.
    private func buildAlarmKitSchedule(schedule: NSDictionary, now: Date) -> Alarm.Schedule? {
        let scheduleType = schedule["type"] as? String ?? "fixed"

        if scheduleType == "relative" {
            let timeDict = schedule["time"] as? NSDictionary
            let hour = timeDict?["hour"] as? Int ?? 8
            let minute = timeDict?["minute"] as? Int ?? 0

            let repeats = schedule["repeats"] as? String ?? "never"
            if repeats == "weekly",
               let days = schedule["daysOfWeek"] as? [Int],
               !days.isEmpty {
                let weekdays: [Foundation.Locale.Weekday] = days.compactMap { mapToLocaleWeekday($0) }
                let rel = Alarm.Schedule.Relative(
                    time: Alarm.Schedule.Relative.Time(hour: hour, minute: minute),
                    repeats: .weekly(weekdays)
                )
                return .relative(rel)
            }

            // Default: never
            let rel = Alarm.Schedule.Relative(
                time: Alarm.Schedule.Relative.Time(hour: hour, minute: minute),
                repeats: .never
            )
            return .relative(rel)
        }

        if scheduleType == "fixed" {
            if let fixedDate = extractDate(from: schedule["date"]) {
                return .fixed(fixedDate)
            }
            // No explicit date: compute today/tomorrow at time
            if let computed = computeNextDateFromTime(schedule: schedule, from: now) {
                return .fixed(computed)
            }
            return nil
        }

        if scheduleType == "recurring" {
            let repeatInterval = schedule["repeatInterval"] as? String
            let timeDict = schedule["time"] as? NSDictionary
            let hour = timeDict?["hour"] as? Int ?? 8
            let minute = timeDict?["minute"] as? Int ?? 0

            if repeatInterval == "weekly",
               let days = schedule["daysOfWeek"] as? [Int],
               !days.isEmpty {
                let weekdays: [Foundation.Locale.Weekday] = days.compactMap { mapToLocaleWeekday($0) }
                let rel = Alarm.Schedule.Relative(
                    time: Alarm.Schedule.Relative.Time(hour: hour, minute: minute),
                    repeats: .weekly(weekdays)
                )
                return .relative(rel)
            }

            // For daily/monthly/yearly (and any other future intervals), schedule the next occurrence as fixed.
            if let startDate = extractDate(from: schedule["startDate"]), startDate > now {
                return .fixed(startDate)
            }
            if let next = calculateNextOccurrenceDate(schedule: schedule, fromDate: now) {
                return .fixed(next)
            }
            // Fallback: schedule next from time today/tomorrow
            if let computed = computeNextDateFromTime(schedule: schedule, from: now) {
                return .fixed(computed)
            }
            return nil
        }

        // interval handled elsewhere; return nil here
        return nil
    }

    /// Compute next date from schedule.time (today at hour/minute or tomorrow if passed).
    private func computeNextDateFromTime(schedule: NSDictionary, from now: Date) -> Date? {
        let time = schedule["time"] as? NSDictionary
        let hour = time?["hour"] as? Int ?? 8
        let minute = time?["minute"] as? Int ?? 0

        var calendar = Calendar.current
        calendar.timeZone = TimeZone.current

        var components = calendar.dateComponents([.year, .month, .day], from: now)
        components.hour = hour
        components.minute = minute
        components.second = 0

        guard var target = calendar.date(from: components) else { return nil }
        if target <= now {
            target = calendar.date(byAdding: .day, value: 1, to: target) ?? target
        }
        return target
    }

    /// Resolve a best-effort next fire date for returning to JS.
    private func resolveNextFireDateFromAlarmKitSchedule(schedule: Alarm.Schedule?, now: Date) -> Date? {
        guard let schedule = schedule else { return nil }
        switch schedule {
        case .fixed(let date):
            return date
        case .relative(let rel):
            // Compute next matching weekday/time from now
            let hour = rel.time.hour
            let minute = rel.time.minute
            var calendar = Calendar.current
            calendar.timeZone = TimeZone.current

            switch rel.repeats {
            case .weekly(let weekdays):
                // Convert Locale.Weekday to Calendar weekday ints (1=Sunday..7=Saturday)
                let allowed: Set<Int> = Set(weekdays.compactMap { wd in
                    switch wd {
                    case .sunday: return 1
                    case .monday: return 2
                    case .tuesday: return 3
                    case .wednesday: return 4
                    case .thursday: return 5
                    case .friday: return 6
                    case .saturday: return 7
                    }
                })

                for i in 0...14 {
                    guard let day = calendar.date(byAdding: .day, value: i, to: now) else { continue }
                    let weekday = calendar.component(.weekday, from: day)
                    if allowed.contains(weekday) {
                        var comps = calendar.dateComponents([.year, .month, .day], from: day)
                        comps.hour = hour
                        comps.minute = minute
                        comps.second = 0
                        if let candidate = calendar.date(from: comps), candidate > now {
                            return candidate
                        }
                    }
                }
                return nil
            case .never:
                // Next occurrence today/tomorrow
                return computeNextDateFromTime(schedule: ["time": ["hour": hour, "minute": minute]] as NSDictionary, from: now)
            }
        }
    }

    /// Build a `thenotifier://notification-display?...` deep link using our strict JS data contract.
    /// Data contract: { notificationId, title, message, note, link }.
    private func buildDeepLinkUrlString(config: NSDictionary) -> String? {
        print("[AlarmKitManager] buildDeepLinkUrlString called with config keys: \(config.allKeys)")
        guard let data = config["data"] as? NSDictionary else {
            print("[AlarmKitManager] buildDeepLinkUrlString: No 'data' key in config")
            return nil
        }
        print("[AlarmKitManager] buildDeepLinkUrlString: data keys: \(data.allKeys)")
        guard let title = data["title"] as? String,
              let message = data["message"] as? String else {
            print("[AlarmKitManager] buildDeepLinkUrlString: Missing title or message in data")
            return nil
        }
        let note = (data["note"] as? String) ?? ""
        let link = (data["link"] as? String) ?? ""

        var components = URLComponents()
        components.scheme = "thenotifier"
        components.host = "notification-display"
        components.queryItems = [
            URLQueryItem(name: "title", value: title),
            URLQueryItem(name: "message", value: message),
            URLQueryItem(name: "note", value: note),
            URLQueryItem(name: "link", value: link),
        ]
        let urlString = components.url?.absoluteString
        print("[AlarmKitManager] buildDeepLinkUrlString: Built URL: \(urlString ?? "nil")")
        return urlString
    }

    /// Extract Date from various possible types in NSDictionary (Double, NSNumber, Date, ISO string)
    private func extractDate(from value: Any?) -> Date? {
        guard let value = value else { return nil }
        
        // Try Double (milliseconds timestamp)
        if let timestamp = value as? Double {
            return Date(timeIntervalSince1970: timestamp / 1000.0)
        }
        
        // Try NSNumber (milliseconds timestamp)
        if let number = value as? NSNumber {
            return Date(timeIntervalSince1970: number.doubleValue / 1000.0)
        }
        
        // Try Date/NSDate directly
        if let date = value as? Date {
            return date
        }
        
        // Try ISO string
        if let isoString = value as? String {
            let formatter = ISO8601DateFormatter()
            return formatter.date(from: isoString)
        }
        
        return nil
    }

    /// Serialize schedule dictionary, ensuring date fields are numbers (milliseconds) for JSON serialization
    private func serializeSchedule(_ schedule: NSDictionary) -> NSDictionary {
        let mutable = NSMutableDictionary(dictionary: schedule)
        
        // Convert date fields to milliseconds (numbers) if they exist
        if let date = extractDate(from: schedule["date"]) {
            mutable["date"] = date.timeIntervalSince1970 * 1000.0
        }
        if let startDate = extractDate(from: schedule["startDate"]) {
            mutable["startDate"] = startDate.timeIntervalSince1970 * 1000.0
        }
        if let startTime = extractDate(from: schedule["startTime"]) {
            mutable["startTime"] = startTime.timeIntervalSince1970 * 1000.0
        }
        
        return mutable
    }

    private func calculateDuration(schedule: NSDictionary) -> TimeInterval {
        let scheduleType = schedule["type"] as? String ?? "fixed"

        if scheduleType == "interval", let intervalMinutes = schedule["intervalMinutes"] as? Int {
            return TimeInterval(intervalMinutes * 60)
        }

        // For fixed alarms with a specific date, use that date
        if scheduleType == "fixed" {
            if let dateValue = extractDate(from: schedule["date"]) {
                let now = Date()
                let duration = dateValue.timeIntervalSince(now)
                // Ensure duration is non-negative (if date is in past, schedule for 1 hour from now)
                if duration > 0 {
                    return duration
                } else {
                    // Date is in the past, log for debugging
                    print("[AlarmKitManager] Warning: Fixed alarm date is in the past: \(dateValue)")
                    return 3600 // Default 1 hour
                }
            } else {
                // Debug logging: log what type we actually got
                if let dateObj = schedule["date"] {
                    let typeName = String(describing: Swift.type(of: dateObj))
                    print("[AlarmKitManager] Warning: Could not extract date from schedule[\"date\"], type: \(typeName), value: \(dateObj)")
                }
            }
        }

        // For fixed without date, or recurring, calculate time until next alarm
        let time = schedule["time"] as? NSDictionary
        let hour = time?["hour"] as? Int ?? 8
        let minute = time?["minute"] as? Int ?? 0

        let now = Date()
        var calendar = Calendar.current
        calendar.timeZone = TimeZone.current

        // For recurring alarms, check if there's a startDate to anchor the series
        var targetDate: Date?
        if let startDate = extractDate(from: schedule["startDate"]) {
            // If startDate is in the future, use it as the first occurrence
            if startDate > now {
                targetDate = startDate
            }
        }

        // If no targetDate yet, calculate next occurrence
        if targetDate == nil {
            var components = calendar.dateComponents([.year, .month, .day], from: now)
            components.hour = hour
            components.minute = minute
            components.second = 0

            guard let baseDate = calendar.date(from: components) else {
                return 3600 // Default 1 hour
            }

            targetDate = baseDate

            // If time has passed today, schedule for tomorrow
            if targetDate! <= now {
                targetDate = calendar.date(byAdding: .day, value: 1, to: targetDate!)
            }
        }

        guard let finalTargetDate = targetDate else {
            return 3600 // Default 1 hour
        }

        return finalTargetDate.timeIntervalSince(now)
    }

    private func calculateNextOccurrenceDate(schedule: NSDictionary, fromDate: Date) -> Date? {
        let scheduleType = schedule["type"] as? String ?? "fixed"
        let repeatInterval = schedule["repeatInterval"] as? String

        // For non-recurring alarms, return nil (no next occurrence)
        if scheduleType == "fixed" && repeatInterval == nil {
            return nil
        }

        let time = schedule["time"] as? NSDictionary
        let hour = time?["hour"] as? Int ?? 8
        let minute = time?["minute"] as? Int ?? 0

        var calendar = Calendar.current
        calendar.timeZone = TimeZone.current

        switch repeatInterval {
        case "daily":
            // Next occurrence is tomorrow at the same time
            var components = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: fromDate)
            components.hour = hour
            components.minute = minute
            components.second = 0
            
            guard let baseDate = calendar.date(from: components) else { return nil }
            
            // If baseDate is today and time hasn't passed, use it; otherwise use tomorrow
            if baseDate <= fromDate {
                return calendar.date(byAdding: .day, value: 1, to: baseDate)
            }
            return baseDate

        case "weekly":
            // Find next occurrence on the specified weekday
            let daysOfWeek = schedule["daysOfWeek"] as? [Int] ?? []
            guard !daysOfWeek.isEmpty else { return nil }
            
            let currentWeekday = calendar.component(.weekday, from: fromDate) - 1 // Convert to 0-6 (Sunday=0)
            
            // Find the next matching weekday
            for i in 1...14 { // Check up to 2 weeks ahead
                guard let checkDate = calendar.date(byAdding: .day, value: i, to: fromDate) else {
                    continue
                }
                let checkWeekday = calendar.component(.weekday, from: checkDate) - 1
                
                if daysOfWeek.contains(checkWeekday) {
                    var components = calendar.dateComponents([.year, .month, .day], from: checkDate)
                    components.hour = hour
                    components.minute = minute
                    components.second = 0
                    return calendar.date(from: components)
                }
            }
            return nil

        case "monthly":
            // Next occurrence on the same day of month next month
            let dayOfMonth = schedule["dayOfMonth"] as? Int ?? calendar.component(.day, from: fromDate)
            
            var components = calendar.dateComponents([.year, .month, .day], from: fromDate)
            let currentMonth = components.month ?? 1
            components.month = currentMonth + 1
            if components.month! > 12 {
                components.month = 1
                components.year = (components.year ?? 2024) + 1
            }
            
            // Handle invalid days (e.g., 31st in February)
            // Clamp to last valid day of month
            guard let tempDate = calendar.date(from: components),
                  let dayRange = calendar.range(of: .day, in: .month, for: tempDate) else {
                return nil
            }
            let clampedDay = min(dayOfMonth, dayRange.upperBound - 1)
            components.day = clampedDay
            components.hour = hour
            components.minute = minute
            components.second = 0
            
            return calendar.date(from: components)

        case "yearly":
            // Next occurrence on the same month/day next year
            let monthOfYear = schedule["monthOfYear"] as? Int ?? calendar.component(.month, from: fromDate)
            let dayOfMonth = schedule["dayOfMonth"] as? Int ?? calendar.component(.day, from: fromDate)
            
            var components = calendar.dateComponents([.year, .month, .day], from: fromDate)
            components.year = (components.year ?? 2024) + 1
            components.month = monthOfYear
            
            // Handle invalid days (e.g., Feb 29 in non-leap year)
            guard let tempDate = calendar.date(from: components),
                  let dayRange = calendar.range(of: .day, in: .month, for: tempDate) else {
                return nil
            }
            let clampedDay = min(dayOfMonth, dayRange.upperBound - 1)
            components.day = clampedDay
            components.hour = hour
            components.minute = minute
            components.second = 0
            
            return calendar.date(from: components)

        default:
            return nil
        }
    }

    private func buildAlarmAttributes(config: NSDictionary) -> AlarmAttributes<BasicAlarmMetadata> {
        let title = config["title"] as? String ?? "Alarm"
        let colorHex = config["color"] as? String ?? "#007AFF"
        let tintColor = hexToColor(colorHex)
        let buttonTextColor: Color = .white 

        // Parse actions from config
        var dismissAction: [String: Any]? = nil
        var snoozeAction: [String: Any]? = nil
        
        if let actions = config["actions"] as? [[String: Any]] {
            for action in actions {
                let behavior = action["behavior"] as? String ?? ""
                if behavior == "dismiss" && dismissAction == nil {
                    dismissAction = action
                } else if behavior == "snooze" && snoozeAction == nil {
                    snoozeAction = action
                }
            }
        }

        // NOTE (iOS 26.1+): AlarmKit's `stopButton` is deprecated and "will no longer be used".
        // The system provides its own dismiss control (the X you’re seeing).
        //
        // We still read the JS "dismiss" action, but we can't reliably customize the system dismiss UI.
        // Primary goal: show Snooze via AlarmKit's `secondaryButton`.

        let titleResource = LocalizedStringResource(stringLiteral: title)

        // Build secondary (snooze) button if provided
        var secondaryButton: AlarmButton? = nil
        var secondaryBehavior: AlarmPresentation.Alert.SecondaryButtonBehavior? = nil

        if let snooze = snoozeAction {
            let snoozeButtonText = snooze["title"] as? String ?? "Snooze"
            // Use a known-good SF Symbol fallback to avoid AlarmKit rejecting the configuration.
            let snoozeButtonIcon = snooze["icon"] as? String ?? "clock.arrow.circlepath"
            secondaryButton = AlarmButton(
                text: LocalizedStringResource(stringLiteral: snoozeButtonText),
                textColor: buttonTextColor,
                systemImageName: snoozeButtonIcon
            )
            // For snooze, the correct behavior is countdown.
            secondaryBehavior = .countdown
        }

        // Build stop button (required parameter)
        let stopButtonText = (dismissAction?["title"] as? String) ?? "Done"
        let stopButtonIcon = (dismissAction?["icon"] as? String) ?? "checkmark.circle.fill"
        let stopButton = AlarmButton(
            text: LocalizedStringResource(stringLiteral: stopButtonText),
            textColor: buttonTextColor,
            systemImageName: stopButtonIcon
        )

        // Build alert presentation (stopButton is required)
        let alert = AlarmPresentation.Alert(
            title: titleResource,
            stopButton: stopButton,
            secondaryButton: secondaryButton,
            secondaryButtonBehavior: secondaryBehavior
        )

        // Provide Countdown/Paused presentations when snooze is enabled.
        // Without these, the Snooze tap can become a no-op (UI presses but alarm remains alerting).
        let presentation: AlarmPresentation
        if secondaryButton != nil {
            let countdown = AlarmPresentation.Countdown(
                title: LocalizedStringResource(stringLiteral: "Snoozed"),
                pauseButton: AlarmButton(
                    text: LocalizedStringResource(stringLiteral: "Pause"),
                    textColor: tintColor,
                    systemImageName: "pause.fill"
                )
            )
            let paused = AlarmPresentation.Paused(
                title: LocalizedStringResource(stringLiteral: "Snoozed"),
                resumeButton: AlarmButton(
                    text: LocalizedStringResource(stringLiteral: "Resume"),
                    textColor: buttonTextColor,
                    systemImageName: "play.fill"
                )
            )
            presentation = AlarmPresentation(alert: alert, countdown: countdown, paused: paused)
        } else {
            presentation = AlarmPresentation(alert: alert)
        }

        let attributes = AlarmAttributes<BasicAlarmMetadata>(
            presentation: presentation,
            tintColor: tintColor
        )

        return attributes
    }

    /// Extract Snooze duration (seconds) from JS config actions.
    /// Returns nil when no snooze action exists.
    private func extractSnoozeSeconds(config: NSDictionary) -> TimeInterval? {
        guard let actions = config["actions"] as? [[String: Any]] else { return nil }
        for action in actions {
            if let behavior = action["behavior"] as? String, behavior == "snooze" {
                // JS provides minutes; convert to seconds
                if let minutes = action["snoozeDuration"] as? Int, minutes > 0 {
                    return TimeInterval(minutes * 60)
                }
                if let minutesNumber = action["snoozeDuration"] as? NSNumber, minutesNumber.intValue > 0 {
                    return TimeInterval(minutesNumber.intValue * 60)
                }
                // Default snooze duration if action exists but missing duration
                return 10 * 60
            }
        }
        return nil
    }

    private func hexToColor(_ hex: String) -> Color {
        var hexSanitized = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        hexSanitized = hexSanitized.replacingOccurrences(of: "#", with: "")

        var rgb: UInt64 = 0
        Scanner(string: hexSanitized).scanHexInt64(&rgb)

        let red = Double((rgb & 0xFF0000) >> 16) / 255.0
        let green = Double((rgb & 0x00FF00) >> 8) / 255.0
        let blue = Double(rgb & 0x0000FF) / 255.0

        return Color(red: red, green: green, blue: blue)
    }

    private func monitorAlarms() async {
        for await alarms in manager.alarmUpdates {
            let currentIds = Set(alarms.map { $0.id.uuidString })
            logger.info("[AlarmKitManager] monitorAlarms() received update with \(alarms.count) alarms. IDs: \(currentIds.joined(separator: ", "), privacy: .public)")
            // Update current alarm IDs for getAllAlarms() to query
            currentAlarmIds = currentIds
            // Store current alarms from AlarmKit for getAllAlarms() to access
            currentAlarmsFromKit.removeAll()
            for alarm in alarms {
                currentAlarmsFromKit[alarm.id.uuidString] = alarm
            }

            for alarm in alarms {
                let alarmId = alarm.id.uuidString

                // Normalize presentation mode
                let currentMode: String = {
                    switch alarm.state {
                    case .alerting: return "alerting"
                    case .countdown: return "countdown"
                    case .paused: return "paused"
                    default: return "other"
                    }
                }()

                let previousMode = lastPresentationModeByAlarmId[alarmId]
                lastPresentationModeByAlarmId[alarmId] = currentMode

                // Detect transitions out of alerting/countdown (user dismissed via system X).
                if let prev = previousMode {
                    let dismissedFromAlerting = (prev == "alerting" && currentMode != "alerting" && currentMode != "countdown")
                    let dismissedFromCountdown = (prev == "countdown" && currentMode != "countdown")
                    if dismissedFromAlerting || dismissedFromCountdown {
                        logger.info("[AlarmKitManager] Alarm dismissed: \(alarmId, privacy: .public), prev=\(prev, privacy: .public), current=\(currentMode, privacy: .public)")
                        if let metadata = alarmMetadataStore[alarmId],
                           let config = metadata["config"] as? NSDictionary,
                           let url = buildDeepLinkUrlString(config: config),
                           !url.isEmpty {
                            logger.info("[AlarmKitManager] Storing deep link URL in UserDefaults: \(url, privacy: .public)")
                            UserDefaults.standard.set(url, forKey: PENDING_ALARM_DEEPLINK_KEY)
                            // Store timestamp to validate freshness
                            UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: PENDING_ALARM_DEEPLINK_TIMESTAMP_KEY)
                            UserDefaults.standard.synchronize() // Force immediate write
                            logger.info("[AlarmKitManager] Deep link URL stored, calling delegate")
                            delegate?.alarmDidRequestDeepLink(url: url)
                        } else {
                            logger.warning("[AlarmKitManager] WARNING: Could not build deep link URL for dismissed alarm \(alarmId, privacy: .public)")
                        }
                    }
                }

                // Fire event when entering alerting
                if currentMode == "alerting" && previousMode != "alerting" {
                    if let metadata = alarmMetadataStore[alarmId],
                       let schedule = metadata["schedule"] as? NSDictionary,
                       let config = metadata["config"] as? NSDictionary {

                        // Serialize schedule to ensure date fields are numbers (not Date objects)
                        let serializedSchedule = serializeSchedule(schedule)

                        let alarmData: [String: Any] = [
                            "id": alarmId,
                            "schedule": serializedSchedule,
                            "config": config,
                            "nextFireDate": ISO8601DateFormatter().string(from: Date()),
                            "capability": "native_alarms",
                            "isActive": true,
                            "platformAlarmId": alarmId
                        ]

                        delegate?.alarmDidFire(alarm: alarmData)

                        // For recurring alarms, reschedule the next occurrence (except weekly, which AlarmKit can handle natively)
                        let scheduleType = schedule["type"] as? String ?? "fixed"
                        let repeatInterval = schedule["repeatInterval"] as? String

                        if scheduleType == "recurring" && repeatInterval != nil && repeatInterval != "weekly" {
                            let now = Date()
                            if let nextOccurrence = calculateNextOccurrenceDate(schedule: schedule, fromDate: now) {
                                // Reschedule for next occurrence using AlarmKit fixed-date alarms
                                let attributes = buildAlarmAttributes(config: config)
                                let uuid = UUID(uuidString: alarmId) ?? UUID()
                                do {
                                    _ = try await manager.schedule(
                                        id: uuid,
                                        configuration: .alarm(
                                            schedule: .fixed(nextOccurrence),
                                            attributes: attributes
                                        )
                                    )
                                } catch {
                                    print("Failed to reschedule recurring alarm \(alarmId): \(error)")
                                }
                            }
                        } else if scheduleType == "fixed" {
                            // One-time alarm: clean up after firing
                            // Use case-insensitive ID matching to ensure cleanup succeeds even if ID casing differs
                            let canonicalId = UUID(uuidString: alarmId)?.uuidString ?? alarmId
                            do {
                                try await cancelAlarm(id: canonicalId)
                                logger.info("[AlarmKitManager] Cleaned up one-time alarm after firing: \(canonicalId, privacy: .public)")
                                
                                // Verify cleanup succeeded by checking if alarm still exists in currentAlarmsFromKit
                                // Wait briefly for AlarmKit to update its internal state
                                try? await Task.sleep(nanoseconds: 100_000_000) // 100ms
                                let stillExists = currentAlarmsFromKit.keys.contains { key in
                                    key.lowercased() == canonicalId.lowercased() || key.lowercased() == alarmId.lowercased()
                                }
                                if stillExists {
                                    logger.warning("[AlarmKitManager] One-time alarm \(canonicalId, privacy: .public) still exists in currentAlarmsFromKit after cleanup attempt, retrying...")
                                    // Retry cleanup once more
                                    try await cancelAlarm(id: canonicalId)
                                    logger.info("[AlarmKitManager] Retried cleanup for one-time alarm: \(canonicalId, privacy: .public)")
                                } else {
                                    logger.info("[AlarmKitManager] Verified one-time alarm cleanup succeeded: \(canonicalId, privacy: .public)")
                                }
                            } catch {
                                logger.error("[AlarmKitManager] Failed to cleanup one-time alarm \(canonicalId, privacy: .public): \(error)")
                                // Best-effort: try cleanup with original ID format in case canonical ID failed
                                if canonicalId != alarmId {
                                    do {
                                        try await cancelAlarm(id: alarmId)
                                        logger.info("[AlarmKitManager] Cleaned up one-time alarm using original ID format: \(alarmId, privacy: .public)")
                                    } catch {
                                        logger.error("[AlarmKitManager] Failed to cleanup one-time alarm with original ID \(alarmId, privacy: .public): \(error)")
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Detect alarms that disappeared from updates (treat as dismissal)
            let knownIds = Set(lastPresentationModeByAlarmId.keys)
            let missing = knownIds.subtracting(currentIds)
            for id in missing {
                if let prev = lastPresentationModeByAlarmId[id], (prev == "alerting" || prev == "countdown") {
                    logger.info("[AlarmKitManager] Alarm disappeared (dismissed): \(id, privacy: .public), prev=\(prev, privacy: .public)")
                    // Try to get URL from UserDefaults first (stored when alarm was scheduled)
                    let storageKey = "\(PENDING_ALARM_DEEPLINK_KEY)_\(id)"
                    var url = UserDefaults.standard.string(forKey: storageKey)
                    
                    // Fallback: build URL from metadata if not in UserDefaults
                    if url == nil || url!.isEmpty {
                        if let metadata = alarmMetadataStore[id],
                           let config = metadata["config"] as? NSDictionary,
                           let builtUrl = buildDeepLinkUrlString(config: config),
                           !builtUrl.isEmpty {
                            url = builtUrl
                            // Store it for future reference
                            UserDefaults.standard.set(url, forKey: storageKey)
                            UserDefaults.standard.synchronize()
                        }
                    }
                    
                    if let finalUrl = url, !finalUrl.isEmpty {
                        logger.info("[AlarmKitManager] Storing deep link URL in UserDefaults (disappeared): \(finalUrl, privacy: .public)")
                        UserDefaults.standard.set(finalUrl, forKey: PENDING_ALARM_DEEPLINK_KEY)
                        // Store timestamp to validate freshness
                        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: PENDING_ALARM_DEEPLINK_TIMESTAMP_KEY)
                        UserDefaults.standard.synchronize() // Force immediate write
                        logger.info("[AlarmKitManager] Deep link URL stored (disappeared), calling delegate")
                        delegate?.alarmDidRequestDeepLink(url: finalUrl)
                    } else {
                        logger.warning("[AlarmKitManager] WARNING: Could not find or build deep link URL for disappeared alarm \(id, privacy: .public)")
                    }
                }
                lastPresentationModeByAlarmId.removeValue(forKey: id)
            }
        }
    }
}
