import Foundation
import Capacitor
import WidgetKit

/// Local Capacitor plugin: hands the widget its data and delivers Siri-logged conversations to the web layer.
@objc(SamvarSharePlugin)
public class SamvarSharePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SamvarSharePlugin"
    public let jsName = "SamvarShare"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setWidgetData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takePendingIntents", returnType: CAPPluginReturnPromise)
    ]

    @objc func setWidgetData(_ call: CAPPluginCall) {
        SharedStore.defaults?.set(call.getString("json") ?? "{}", forKey: SharedStore.widgetKey)
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    @objc func takePendingIntents(_ call: CAPPluginCall) {
        call.resolve(["items": SharedStore.takePending()])
    }
}
