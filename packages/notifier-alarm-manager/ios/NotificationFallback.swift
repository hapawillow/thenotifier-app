import Foundation
import UserNotifications

class NotificationFallback: NSObject {

    weak var delegate: AlarmDelegate?
    private let notificationCenter = UNUserNotificationCenter.current()
    private var alarmStore: [String: [String: Any]] = [:]
    private weak var previousDelegate: UNUserNotificationCenterDelegate?

    override init() {
        super.init()
        // Preserve any existing delegate (e.g. expo-notifications) so we can forward calls.
        previousDelegate = notificationCenter.delegate as? UNUserNotificationCenterDelegate
        notificationCenter.delegate = self
    }

    // MARK: - Permission

    func requestPermission() async throws -> Bool {
        let granted = try await notificationCenter.requestAuthorization(options: [.alert, .sound, .badge])
        return granted
    }

    // MARK: - Scheduling

    func scheduleAlarm(schedule: NSDictionary, config: NSDictionary) async throws -> [String: Any] {
        let alarmId = schedule["id"] as? String ?? UUID().uuidString
        let type = schedule["type"] as? String ?? "fixed"

        // Store alarm metadata
        alarmStore[alarmId] = [
            "schedule": schedule,
            "config": config
        ]

        // Build notification requests based on type
        switch type {
        case "recurring":
            try await scheduleRecurringNotification(alarmId: alarmId, schedule: schedule, config: config)
        case "interval":
            try await scheduleIntervalNotification(alarmId: alarmId, schedule: schedule, config: config)
        case "fixed":
            try await scheduleFixedNotification(alarmId: alarmId, schedule: schedule, config: config)
        default:
            throw NSError(
                domain: "NotificationFallback",
                code: 400,
                userInfo: [NSLocalizedDescriptionKey: "Invalid schedule type: \(type)"]
            )
        }

        let nextFireDate = calculateNextFireDate(schedule: schedule)

        return [
            "id": alarmId,
            "schedule": schedule,
            "config": config,
            "nextFireDate": ISO8601DateFormatter().string(from: nextFireDate),
            "capability": "notification",
            "isActive": true,
            "platformAlarmId": alarmId
        ]
    }

    func cancelAlarm(id: String) async throws {
        notificationCenter.removePendingNotificationRequests(withIdentifiers: [id])
        notificationCenter.removeDeliveredNotifications(withIdentifiers: [id])
        alarmStore.removeValue(forKey: id)
    }

    func cancelAllAlarms() async throws {
        notificationCenter.removeAllPendingNotificationRequests()
        notificationCenter.removeAllDeliveredNotifications()
        alarmStore.removeAll()
    }

    func cancelAlarmsByCategory(category: String) async throws {
        var idsToRemove: [String] = []

        for (id, metadata) in alarmStore {
            guard let config = metadata["config"] as? NSDictionary,
                  let alarmCategory = config["category"] as? String,
                  alarmCategory == category else {
                continue
            }
            idsToRemove.append(id)
        }

        notificationCenter.removePendingNotificationRequests(withIdentifiers: idsToRemove)
        notificationCenter.removeDeliveredNotifications(withIdentifiers: idsToRemove)

        for id in idsToRemove {
            alarmStore.removeValue(forKey: id)
        }
    }

    // MARK: - Query

    func getAlarm(id: String) async throws -> [String: Any]? {
        guard let metadata = alarmStore[id],
              let schedule = metadata["schedule"] as? NSDictionary,
              let config = metadata["config"] as? NSDictionary else {
            return nil
        }

        let nextFireDate = calculateNextFireDate(schedule: schedule)

        return [
            "id": id,
            "schedule": schedule,
            "config": config,
            "nextFireDate": ISO8601DateFormatter().string(from: nextFireDate),
            "capability": "notification",
            "isActive": true,
            "platformAlarmId": id
        ]
    }

    func getAllAlarms() async throws -> [[String: Any]] {
        var alarms: [[String: Any]] = []

        for (id, _) in alarmStore {
            if let alarm = try await getAlarm(id: id) {
                alarms.append(alarm)
            }
        }

        return alarms
    }

    func getAlarmsByCategory(category: String) async throws -> [[String: Any]] {
        var alarms: [[String: Any]] = []

        for (id, metadata) in alarmStore {
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
        guard let metadata = alarmStore[id],
              let schedule = metadata["schedule"] as? NSDictionary,
              let config = metadata["config"] as? NSDictionary else {
            throw NSError(
                domain: "NotificationFallback",
                code: 404,
                userInfo: [NSLocalizedDescriptionKey: "Alarm not found"]
            )
        }

        // Cancel current alarm
        try await cancelAlarm(id: id)

        // Reschedule for snooze duration
        var mutableSchedule = schedule.mutableCopy() as! NSMutableDictionary
        mutableSchedule["type"] = "interval"
        mutableSchedule["intervalMinutes"] = minutes
        mutableSchedule["startTime"] = Date()

        _ = try await scheduleAlarm(schedule: mutableSchedule, config: config)
    }

    // MARK: - Notification Scheduling

    private func scheduleFixedNotification(alarmId: String, schedule: NSDictionary, config: NSDictionary) async throws {
        let content = buildNotificationContent(config: config, alarmId: alarmId)

        let time = schedule["time"] as? NSDictionary
        let hour = time?["hour"] as? Int ?? 8
        let minute = time?["minute"] as? Int ?? 0

        // Extract date components for one-time alarm
        var dateComponents = DateComponents()
        
        // Extract date from schedule - React Native passes Date as timestamp (Double)
        if let dateTimestamp = schedule["date"] as? Double {
            // Date is passed as milliseconds timestamp from JavaScript
            let dateValue = Date(timeIntervalSince1970: dateTimestamp / 1000.0)
            let calendar = Calendar.current
            dateComponents = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: dateValue)
        } else if let dateValue = schedule["date"] as? Date {
            // Direct Date object (shouldn't happen but handle it)
            let calendar = Calendar.current
            dateComponents = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: dateValue)
        } else {
            // No date provided - use today's date with the specified time
            // If time has already passed today, use tomorrow
            let calendar = Calendar.current
            let now = Date()
            var components = calendar.dateComponents([.year, .month, .day], from: now)
            components.hour = hour
            components.minute = minute
            
            if let scheduledDate = calendar.date(from: components), scheduledDate < now {
                // Time has passed today, schedule for tomorrow
                if let tomorrow = calendar.date(byAdding: .day, value: 1, to: scheduledDate) {
                    components = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: tomorrow)
                }
            }
            dateComponents = components
        }

        let trigger = UNCalendarNotificationTrigger(dateMatching: dateComponents, repeats: false)
        let request = UNNotificationRequest(identifier: alarmId, content: content, trigger: trigger)

        try await notificationCenter.add(request)
    }

    private func scheduleRecurringNotification(alarmId: String, schedule: NSDictionary, config: NSDictionary) async throws {
        let content = buildNotificationContent(config: config, alarmId: alarmId)

        let time = schedule["time"] as? NSDictionary
        let hour = time?["hour"] as? Int ?? 8
        let minute = time?["minute"] as? Int ?? 0
        let daysOfWeek = schedule["daysOfWeek"] as? [Int] ?? []

        if daysOfWeek.isEmpty {
            // Daily alarm
            var dateComponents = DateComponents()
            dateComponents.hour = hour
            dateComponents.minute = minute

            let trigger = UNCalendarNotificationTrigger(dateMatching: dateComponents, repeats: true)
            let request = UNNotificationRequest(identifier: alarmId, content: content, trigger: trigger)

            try await notificationCenter.add(request)
        } else {
            // Specific days of week - need to create multiple notification requests
            for dayOfWeek in daysOfWeek {
                let notificationId = "\(alarmId)-day\(dayOfWeek)"

                var dateComponents = DateComponents()
                dateComponents.hour = hour
                dateComponents.minute = minute
                dateComponents.weekday = dayOfWeek + 1 // iOS weekday is 1-7, not 0-6

                let trigger = UNCalendarNotificationTrigger(dateMatching: dateComponents, repeats: true)
                let request = UNNotificationRequest(identifier: notificationId, content: content, trigger: trigger)

                try await notificationCenter.add(request)
            }
        }
    }

    private func scheduleIntervalNotification(alarmId: String, schedule: NSDictionary, config: NSDictionary) async throws {
        let content = buildNotificationContent(config: config, alarmId: alarmId)

        let intervalMinutes = schedule["intervalMinutes"] as? Int ?? 60
        let intervalSeconds = TimeInterval(intervalMinutes * 60)

        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: intervalSeconds, repeats: false)
        let request = UNNotificationRequest(identifier: alarmId, content: content, trigger: trigger)

        try await notificationCenter.add(request)
    }

    private func buildNotificationContent(config: NSDictionary, alarmId: String) -> UNMutableNotificationContent {
        let content = UNMutableNotificationContent()

        content.title = config["title"] as? String ?? "Alarm"
        if let body = config["body"] as? String {
            content.body = body
        }

        // Sound
        if let soundName = config["sound"] as? String {
            if soundName == "default" {
                content.sound = .default
            } else if soundName != "none" {
                content.sound = UNNotificationSound(named: UNNotificationSoundName(rawValue: "\(soundName).wav"))
            }
        } else {
            content.sound = .default
        }

        // Category for actions
        if let actions = config["actions"] as? [[String: Any]], !actions.isEmpty {
            let categoryId = "alarm-\(alarmId)"
            content.categoryIdentifier = categoryId

            // Register category with actions
            var notificationActions: [UNNotificationAction] = []

            for action in actions.prefix(4) { // iOS supports up to 4 actions
                let actionId = action["id"] as? String ?? UUID().uuidString
                let actionTitle = action["title"] as? String ?? "Action"

                let notificationAction = UNNotificationAction(
                    identifier: actionId,
                    title: actionTitle,
                    options: [.foreground]
                )

                notificationActions.append(notificationAction)
            }

            let category = UNNotificationCategory(
                identifier: categoryId,
                actions: notificationActions,
                intentIdentifiers: [],
                options: []
            )

            notificationCenter.setNotificationCategories([category])
        }

        // User info
        var userInfo: [String: Any] = [
            "alarmId": alarmId
        ]

        if let data = config["data"] as? [String: Any] {
            userInfo["data"] = data
        }

        content.userInfo = userInfo

        return content
    }

    private func calculateNextFireDate(schedule: NSDictionary) -> Date {
        let type = schedule["type"] as? String ?? "fixed"
        let time = schedule["time"] as? NSDictionary
        let hour = time?["hour"] as? Int ?? 8
        let minute = time?["minute"] as? Int ?? 0

        let now = Date()
        var calendar = Calendar.current
        calendar.timeZone = TimeZone.current

        if type == "interval" {
            let intervalMinutes = schedule["intervalMinutes"] as? Int ?? 60
            if let startTime = schedule["startTime"] as? Date {
                return calendar.date(byAdding: .minute, value: intervalMinutes, to: startTime) ?? now
            }
            return calendar.date(byAdding: .minute, value: intervalMinutes, to: now) ?? now
        }

        var components = calendar.dateComponents([.year, .month, .day], from: now)
        components.hour = hour
        components.minute = minute
        components.second = 0

        guard var targetDate = calendar.date(from: components) else {
            return now
        }

        // If time has passed today, schedule for tomorrow or next occurrence
        if targetDate <= now {
            if type == "recurring" {
                let daysOfWeek = schedule["daysOfWeek"] as? [Int] ?? []
                if !daysOfWeek.isEmpty {
                    // Find next day of week
                    let currentWeekday = calendar.component(.weekday, from: now) - 1
                    var daysToAdd = 1

                    for i in 1...7 {
                        let checkDay = (currentWeekday + i) % 7
                        if daysOfWeek.contains(checkDay) {
                            daysToAdd = i
                            break
                        }
                    }

                    targetDate = calendar.date(byAdding: .day, value: daysToAdd, to: targetDate)!
                } else {
                    targetDate = calendar.date(byAdding: .day, value: 1, to: targetDate)!
                }
            } else {
                targetDate = calendar.date(byAdding: .day, value: 1, to: targetDate)!
            }
        }

        return targetDate
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension NotificationFallback: UNUserNotificationCenterDelegate {

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // If there was a previous delegate (e.g. expo-notifications), forward to it so it
        // can handle the notification as well. Let the previous delegate decide how to
        // call the completion handler.
        if let previousDelegate = previousDelegate {
            previousDelegate.userNotificationCenter?(center, willPresent: notification, withCompletionHandler: completionHandler)
            return
        }

        // Fallback behavior: show notification even when app is in foreground
        completionHandler([.banner, .sound, .badge])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo

        guard let alarmId = userInfo["alarmId"] as? String else {
            // Not one of our alarms – forward to previous delegate if any, otherwise just complete.
            if let previousDelegate = previousDelegate {
                previousDelegate.userNotificationCenter?(center, didReceive: response, withCompletionHandler: completionHandler)
            } else {
                completionHandler()
            }
            return
        }

        // Handle action for our alarm
        let actionId = response.actionIdentifier

        if actionId == UNNotificationDefaultActionIdentifier {
            // User tapped notification
            notifyAlarmFired(alarmId: alarmId, actionId: nil)
        } else {
            // User tapped action button
            notifyAlarmFired(alarmId: alarmId, actionId: actionId)
        }

        // Also forward the response to any previous delegate (e.g. expo-notifications) so
        // it can emit JS events. Let it manage the completion handler.
        if let previousDelegate = previousDelegate {
            previousDelegate.userNotificationCenter?(center, didReceive: response, withCompletionHandler: completionHandler)
        } else {
            completionHandler()
        }
    }

    private func notifyAlarmFired(alarmId: String, actionId: String?) {
        guard let metadata = alarmStore[alarmId],
              let schedule = metadata["schedule"] as? NSDictionary,
              let config = metadata["config"] as? NSDictionary else {
            return
        }

        var alarmData: [String: Any] = [
            "id": alarmId,
            "schedule": schedule,
            "config": config,
            "nextFireDate": ISO8601DateFormatter().string(from: Date()),
            "capability": "notification",
            "isActive": true
        ]

        if let actionId = actionId {
            alarmData["actionId"] = actionId
        }

        delegate?.alarmDidFire(alarm: alarmData)

        // For interval alarms, reschedule
        let type = schedule["type"] as? String
        if type == "interval" {
            Task {
                _ = try? await scheduleAlarm(schedule: schedule, config: config)
            }
        }
    }
}
