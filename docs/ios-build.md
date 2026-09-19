# Building Samvar for iOS

Prerequisites (one-time): Xcode from the Mac App Store (open it once, accept the licence), then
`sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`, Homebrew, `brew install node`.

## First build

```bash
npm install
npx cap add ios
```

Icons and splash from the SVG sources:

```bash
mkdir -p assets && cp branding/icon.svg assets/logo.svg && cp branding/splash.svg assets/splash.svg
npm run assets
```

(`@capacitor/assets` accepts `assets/logo.svg` and `assets/splash.svg`; it writes every required PNG size into the Xcode asset catalog, without alpha.)

Then copy the web app into the native project and open Xcode:

```bash
npx cap sync ios
npx cap open ios
```

## In Xcode (once)

1. **Signing & Capabilities** → Team = your Apple Developer account. Bundle identifier `app.samvar.ios` (change in `capacitor.config.json` too if you pick another).
2. **Info.plist** — add these usage strings (Apple rejects builds that touch these APIs without them):
   - `NSContactsUsageDescription` — "Samvar lets you pick contacts to add to your circles. Only the people you choose are saved, on this phone."
   - `NSLocationWhenInUseUsageDescription` — "Used for “Near me” and to note where you saw someone. Never uploaded."
   - `ITSAppUsesNonExemptEncryption` = `NO` (HTTPS only).
3. **Deployment target** iOS 16.0 or later.
4. Product → Run on a simulator, then on your iPhone (plug in, trust the Mac).

## Every time the web app changes

```bash
npx cap sync ios
```

then build in Xcode. (`www/` is copied into the app bundle; no bundler step — it is plain HTML/JS.)

## Versions that are known to work together (Sept 2026)

Xcode 27 · Capacitor 8.5 · iOS deployment target 16.0 (Xcode 27 refuses anything below 15) · CocoaPods 1.17 · `@revenuecat/purchases-capacitor` 13.x (needs Capacitor ≥ 8). If `pod install` complains about incompatible versions after a plugin upgrade, delete `ios/App/Podfile.lock` and run `pod install --repo-update`.

Command-line build check without opening Xcode:

```bash
cd ios/App && xcodebuild -workspace App.xcworkspace -scheme App -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build | grep -E "error:|BUILD"
```

## RevenueCat

Set `RC_IOS_KEY` in `www/native.js` to the **public** iOS SDK key from RevenueCat → Project → API keys. Products `samvar_pro_monthly` and `samvar_pro_yearly` must exist in App Store Connect (with a 7-day free introductory offer) and be attached to the `pro` entitlement in RevenueCat. Sandbox testers are created in App Store Connect → Users and Access → Sandbox.

## TestFlight

Product → Archive → Distribute App → App Store Connect → Upload. First upload of a new bundle id creates the app record; fill in the listing from `store/listing.md`, add testers under TestFlight, and Apple's beta review usually clears in a day.

## What the native layer provides (`www/native.js`)

`window.SamvarNative` — used by `app.js` only when present, so the same code runs on the web:

| Method | Backed by |
|---|---|
| `scheduleNudges()` | `@capacitor/local-notifications` — clears and re-schedules the next 14 nudges from the user's frequency/time |
| `pickContact()` | `@capacitor-community/contacts` — native picker, returns `{name, tel, addr}` |
| `purchase(plan)` / `restore()` | `@revenuecat/purchases-capacitor` |
| `haptic(kind)` | `@capacitor/haptics` |
| `share(text)` | `@capacitor/share` |

The bridge is loaded after `app.js`; on the web `window.Capacitor` is undefined and the bridge does nothing.
