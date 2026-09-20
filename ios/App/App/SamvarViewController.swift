import UIKit
import Capacitor

class SamvarViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SamvarSharePlugin())
    }
}
