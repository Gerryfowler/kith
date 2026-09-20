import WidgetKit
import SwiftUI

struct Snapshot: Codable {
    var name: String?; var initials: String?; var why: String?
    var streak: Int?; var score: Int?; var target: Int?; var updated: Double?
}

func loadSnapshot() -> Snapshot {
    if let s = UserDefaults(suiteName: "group.app.samvar.ios")?.string(forKey: "widget"),
       let d = s.data(using: .utf8), let snap = try? JSONDecoder().decode(Snapshot.self, from: d) { return snap }
    return Snapshot()
}

struct Entry: TimelineEntry { let date: Date; let snap: Snapshot }

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry {
        Entry(date: Date(), snap: Snapshot(name: "Kate Bell", initials: "KB", why: "3 days before she slips out of your weekly rhythm", streak: 4, score: 62, target: 78))
    }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) { completion(Entry(date: Date(), snap: loadSnapshot())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        let next = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date().addingTimeInterval(3600)
        completion(Timeline(entries: [Entry(date: Date(), snap: loadSnapshot())], policy: .after(next)))
    }
}

extension Color {
    init(hex: UInt32) { self.init(red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255, blue: Double(hex & 0xff) / 255) }
}
let cream = Color(hex: 0xfaf6ee), ink = Color(hex: 0x1f1c17), muted = Color(hex: 0x7a7266), accent = Color(hex: 0x2a78d6), lav = Color(hex: 0xe6e0f7)

struct SamvarWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: Entry
    var snap: Snapshot { entry.snap }
    var streakText: String { "🔥 \(snap.streak ?? 0)-day streak" }

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack { AccessoryWidgetBackground(); VStack(spacing: -2) { Text("🔥").font(.caption2); Text("\(snap.streak ?? 0)").font(.headline).bold() } }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text(snap.name ?? "Samvar").font(.headline).lineLimit(1)
                Text(snap.why ?? "Everyone's in rhythm").font(.caption2).lineLimit(2)
                Text(streakText).font(.caption2)
            }
        case .systemMedium:
            HStack(spacing: 14) {
                avatar(size: 56)
                VStack(alignment: .leading, spacing: 4) {
                    Text("NEXT UP").font(.caption2).bold().foregroundColor(muted).kerning(0.6)
                    Text(snap.name ?? "Everyone's in rhythm").font(.title3).bold().foregroundColor(ink).lineLimit(1)
                    Text(snap.why ?? "Samvar will nudge you when someone drifts.").font(.caption).foregroundColor(ink).lineLimit(2)
                    HStack { Text(streakText); Spacer(); Text("Score \(snap.score ?? 0)") }.font(.caption2).foregroundColor(muted)
                }
                Spacer(minLength: 0)
            }.padding(14)
        default:
            VStack(alignment: .leading, spacing: 6) {
                HStack { Text("NEXT UP").font(.caption2).bold().foregroundColor(muted).kerning(0.6); Spacer(); avatar(size: 30) }
                Text(snap.name ?? "All in rhythm").font(.headline).foregroundColor(ink).lineLimit(1)
                Text(snap.why ?? "Nice — enjoy it.").font(.caption2).foregroundColor(ink).lineLimit(3)
                Spacer(minLength: 0)
                Text(streakText).font(.caption2).foregroundColor(muted)
            }.padding(14)
        }
    }

    @ViewBuilder func avatar(size: CGFloat) -> some View {
        ZStack { Circle().fill(lav); Text(snap.initials ?? "🌱").font(.system(size: size * 0.38, weight: .bold)).foregroundColor(ink) }.frame(width: size, height: size)
    }
}

struct WidgetBackground: ViewModifier {
    let family: WidgetFamily
    func body(content: Content) -> some View {
        if #available(iOS 17.0, *) {
            content.containerBackground(for: .widget) { family.isAccessory ? Color.clear : cream }
        } else {
            content.background(family.isAccessory ? Color.clear : cream)
        }
    }
}
extension WidgetFamily { var isAccessory: Bool { self == .accessoryCircular || self == .accessoryRectangular || self == .accessoryInline } }

struct SamvarWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SamvarNextUp", provider: Provider()) { entry in
            SamvarWidgetView(entry: entry)
                .modifier(WidgetBackground(family: WidgetFamily.systemSmall))
                .widgetURL(URL(string: "samvar://today"))
        }
        .configurationDisplayName("Next up")
        .description("Who to reach out to today, and your streak.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular])
    }
}

@main
struct SamvarWidgetBundle: WidgetBundle {
    var body: some Widget { SamvarWidget() }
}
