import AppIntents
import Foundation

@available(iOS 16.0, *)
enum ConversationKind: String, AppEnum {
    case call, message, inperson
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "How"
    static var caseDisplayRepresentations: [ConversationKind: DisplayRepresentation] = [
        .call: "a call", .message: "a message", .inperson: "in person"
    ]
}

/// "Hey Siri, log that I called Kate in Samvar" — queued in the App Group and picked up when the app next opens.
@available(iOS 16.0, *)
struct LogConversationIntent: AppIntent {
    static var title: LocalizedStringResource = "Log a conversation"
    static var description = IntentDescription("Logs a quick catch-up with someone in Samvar.")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Who") var person: String
    @Parameter(title: "How", default: .call) var kind: ConversationKind

    static var parameterSummary: some ParameterSummary {
        Summary("Log \(\.$kind) with \(\.$person)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        SharedStore.addPending(["person": person, "kind": kind.rawValue, "ts": Date().timeIntervalSince1970 * 1000])
        let how = kind == .inperson ? "a catch-up" : kind == .call ? "a call" : "a message"
        return .result(dialog: "Logged \(how) with \(person) in Samvar.")
    }
}

@available(iOS 16.0, *)
struct OpenTodayIntent: AppIntent {
    static var title: LocalizedStringResource = "Who should I reach out to?"
    static var description = IntentDescription("Opens Samvar on today's pick.")
    static var openAppWhenRun: Bool = true
    func perform() async throws -> some IntentResult { .result() }
}

@available(iOS 16.0, *)
struct SamvarShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: LogConversationIntent(), phrases: [
            "Log a conversation in \(.applicationName)",
            "Log that I called someone in \(.applicationName)",
            "Tell \(.applicationName) I spoke to someone"
        ])
        AppShortcut(intent: OpenTodayIntent(), phrases: [
            "Who should I reach out to in \(.applicationName)",
            "Open \(.applicationName) today"
        ])
    }
}
