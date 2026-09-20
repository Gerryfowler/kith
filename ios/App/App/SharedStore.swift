import Foundation

/// Data shared between the app, the widget and Siri intents via the App Group container.
enum SharedStore {
    static let group = "group.app.samvar.ios"
    static let widgetKey = "widget"
    static let pendingKey = "pendingIntents"
    static var defaults: UserDefaults? { UserDefaults(suiteName: group) }

    static func addPending(_ item: [String: Any]) {
        var arr = (defaults?.array(forKey: pendingKey) as? [[String: Any]]) ?? []
        arr.append(item)
        defaults?.set(arr, forKey: pendingKey)
    }
    static func takePending() -> [[String: Any]] {
        let arr = (defaults?.array(forKey: pendingKey) as? [[String: Any]]) ?? []
        defaults?.removeObject(forKey: pendingKey)
        return arr
    }
}
