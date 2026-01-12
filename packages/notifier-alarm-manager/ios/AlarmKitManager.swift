import Foundation
import AlarmKit
import ActivityKit
import SwiftUI
import AppIntents
import OSLog

private let PENDING_ALARM_DEEPLINK_KEY = "thenotifier_pending_alarm_deeplink_url"
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
            logger.error("[AlarmKitStopIntent] Invalid alarm ID: \(alarmID)")
            return .result()
        }
        
        logger.info("[AlarmKitStopIntent] perform() called for alarm: \(alarmID), url parameter: \(url ?? "nil")")
        
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
            logger.info("[AlarmKitStopIntent] Storing deep link URL in UserDefaults: \(finalUrlString)")
            UserDefaults.standard.set(finalUrlString, forKey: PENDING_ALARM_DEEPLINK_KEY)
            UserDefaults.standard.synchronize() // Force immediate write
            
            // Verify it was stored correctly
            let verifyUrl = UserDefaults.standard.string(forKey: PENDING_ALARM_DEEPLINK_KEY)
            if verifyUrl == finalUrlString {
                logger.info("[AlarmKitStopIntent] Deep link URL stored and verified successfully")
            } else {
                logger.error("[AlarmKitStopIntent] ERROR: URL storage verification failed! Stored: \(finalUrlString), Retrieved: \(verifyUrl ?? "nil")")
            }
            
            // Note: The monitorAlarms() function will detect the dismissal and call the delegate
            // to emit the deep link event to JS. We just store the URL here.
        } else {
            logger.warning("[AlarmKitStopIntent] WARNING: No URL available to store (parameter: \(url ?? "nil"), UserDefaults: \(UserDefaults.standard.string(forKey: PENDING_ALARM_DEEPLINK_KEY) ?? "nil"))")
        }

        // Best-effort stop (the system may already be dismissing UI).
        try? AlarmManager.shared.stop(id: uuid)
        logger.info("[AlarmKitStopIntent] perform() completed")
        return .result()
    }
}

// Metadata for alarms
nonisolated struct BasicAlarmMetadata: AlarmMetadata {
    // Empty metadata for basic alarms
}

@available(iOS 26.0, *)
class AlarmKitManager {

    weak var delegate: AlarmDelegate?
    private let manager = AlarmManager.shared
    private var alarmMetadataStore: [String: [String: Any]] = [:]
    private var lastPresentationModeByAlarmId: [String: String] = [:]

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

        // Store metadata using canonical UUID string (AlarmKit reports ids using uuidString which may differ in casing).
        alarmMetadataStore[canonicalAlarmId] = [
            "schedule": schedule,
            "config": config
        ]

        // AlarmKit supports true alarm scheduling via AlarmConfiguration.alarm(schedule:...)
        // Use alarm schedules for fixed/recurring to avoid timer limitations and ensure calendar dates are honored.
        let now = Date()
        let alarmSchedule = buildAlarmKitSchedule(schedule: schedule, now: now)

        // Build deep link to Notification Detail (scheme URL) using the strict data contract.
        let deepLinkUrlString: String? = buildDeepLinkUrlString(config: config)
        logger.info("[AlarmKitManager] Built deep link URL: \(deepLinkUrlString ?? "nil")")
        
        // Store the deep link URL in UserDefaults NOW (when scheduling), so it's available even if
        // perform() isn't called when the app launches from a closed state.
        // We'll use the alarm ID as part of the key to support multiple alarms.
        if let urlString = deepLinkUrlString, !urlString.isEmpty {
            let storageKey = "\(PENDING_ALARM_DEEPLINK_KEY)_\(canonicalAlarmId)"
            logger.info("[AlarmKitManager] Storing deep link URL in UserDefaults (key: \(storageKey)): \(urlString)")
            UserDefaults.standard.set(urlString, forKey: storageKey)
            UserDefaults.standard.synchronize()
            // Also store under the main key (for backward compatibility and easy lookup)
            logger.info("[AlarmKitManager] Also storing under main key: \(PENDING_ALARM_DEEPLINK_KEY)")
            UserDefaults.standard.set(urlString, forKey: PENDING_ALARM_DEEPLINK_KEY)
            UserDefaults.standard.synchronize()
            logger.info("[AlarmKitManager] Deep link URL stored successfully for alarm: \(canonicalAlarmId)")
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
        logger.info("[AlarmKitManager] Set stopIntent.url to: \(stopIntentValue.url ?? "nil")")
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

        // Serialize schedule to ensure date fields are numbers (not Date objects)
        let serializedSchedule = serializeSchedule(schedule)

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

        // AlarmKit's cancel and stop are synchronous-throwing (not async)
        // Attempt cancel first (primary operation)
        do {
            try manager.cancel(id: uuid)
        } catch {
            // If cancel fails, still try stop as fallback
            print("[AlarmKitManager] cancel failed for \(id), attempting stop: \(error)")
        }
        
        // Best-effort stop to dismiss alarms that might be in .alerting state
        do {
            try manager.stop(id: uuid)
        } catch {
            // Ignore stop errors - it's best-effort cleanup
            print("[AlarmKitManager] stop failed for \(id) (may not be alerting): \(error)")
        }
        
        alarmMetadataStore.removeValue(forKey: id)
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

        for (id, _) in alarmMetadataStore {
            if let alarm = try await getAlarm(id: id) {
                alarms.append(alarm)
            }
        }

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
                        logger.info("[AlarmKitManager] Alarm dismissed: \(alarmId), prev=\(prev), current=\(currentMode)")
                        if let metadata = alarmMetadataStore[alarmId],
                           let config = metadata["config"] as? NSDictionary,
                           let url = buildDeepLinkUrlString(config: config),
                           !url.isEmpty {
                            logger.info("[AlarmKitManager] Storing deep link URL in UserDefaults: \(url)")
                            UserDefaults.standard.set(url, forKey: PENDING_ALARM_DEEPLINK_KEY)
                            UserDefaults.standard.synchronize() // Force immediate write
                            logger.info("[AlarmKitManager] Deep link URL stored, calling delegate")
                            delegate?.alarmDidRequestDeepLink(url: url)
                        } else {
                            logger.warning("[AlarmKitManager] WARNING: Could not build deep link URL for dismissed alarm \(alarmId)")
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
                        }
                    }
                }
            }

        // Detect alarms that disappeared from updates (treat as dismissal)
        let knownIds = Set(lastPresentationModeByAlarmId.keys)
        let missing = knownIds.subtracting(currentIds)
        for id in missing {
            if let prev = lastPresentationModeByAlarmId[id], (prev == "alerting" || prev == "countdown") {
                logger.info("[AlarmKitManager] Alarm disappeared (dismissed): \(id), prev=\(prev)")
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
                    logger.info("[AlarmKitManager] Storing deep link URL in UserDefaults (disappeared): \(finalUrl)")
                    UserDefaults.standard.set(finalUrl, forKey: PENDING_ALARM_DEEPLINK_KEY)
                    UserDefaults.standard.synchronize() // Force immediate write
                    logger.info("[AlarmKitManager] Deep link URL stored (disappeared), calling delegate")
                    delegate?.alarmDidRequestDeepLink(url: finalUrl)
                } else {
                    logger.warning("[AlarmKitManager] WARNING: Could not find or build deep link URL for disappeared alarm \(id)")
                }
            }
            lastPresentationModeByAlarmId.removeValue(forKey: id)
        }
        }
    }
}
