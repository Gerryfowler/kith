import UIKit
import Capacitor

/// Root view controller (see SceneDelegate): registers the app's local Capacitor plugins.
class SamvarViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SamvarSharePlugin())
    }
}
