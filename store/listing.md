# Samvar — App Store listing (draft v1)

## Identity
- **App name** (30 max): `Samvar`
- **Subtitle** (30 max): `Build friendships like fitness`
- **Bundle ID**: `app.samvar.ios` (change if you register a different domain)
- **Primary category**: Lifestyle · **Secondary**: Productivity
- **Age rating**: 4+ (no objectionable content; questionnaire all "No")
- **Price**: Free to download; one auto-renewing subscription "Samvar Pro" (base price USD 4.99/month, USD 49.99/year; Apple sets local equivalents, roughly £4.99 and £49.99) with a 7-day free introductory offer on both. No free tier.
- **Seller**: Gerry Fowler (individual account; migrate to a company later via App Store Connect → Agreements)

## Promotional text (170 max, editable without a new build)
The friendships you'd hate to lose, quietly kept alive. Samvar tells you who's slipping, remembers what matters to them, and drafts the first line.

## Description (4000 max)
Most of us don't lose friends on purpose. We just go quiet — a busy month becomes a year, and the people who matter drift out of rhythm.

Samvar is a small, calm app that keeps that from happening.

**Put your people in circles.** Inner, Close, Friendly. Each has its own natural rhythm — weekly, monthly, a few times a year — and Samvar watches the gaps so you don't have to.

**Just talk.** After a coffee, a call, a long walk — dictate a sentence or two. Samvar works out who you saw, who reached out, how deep it went, and files the things worth remembering: their kid's name, the marathon they're training for, the job interview on Thursday.

**Reach out today.** Every morning, a handful of gentle nudges: who's fading, whose birthday is Thursday, who reached out last time so it's your turn, two friends who'd love each other but have never met. One tap drafts a warm, specific opener from what you actually know about them, and sends it in Messages or WhatsApp.

**See it working.** A connection score that genuinely goes backwards when you go quiet. Rhythm rings for each circle. Net connection days that go up when you log a conversation and down when you don't. A constellation of who you see together, and the groups that build themselves from it.

**Private by design.** Your people, notes and history live on your phone. No accounts, no ads, no selling data. Back up to a file whenever you like.

Try everything free for 7 days. Then Samvar is about the price of one coffee with a friend each month, or less on the yearly plan.

— 
Samvar Pro is an auto-renewing subscription with a 7-day free trial. Payment is charged to your Apple ID account at confirmation of purchase. The subscription renews automatically unless cancelled at least 24 hours before the end of the current period. Manage or cancel in Settings → Apple ID → Subscriptions. Privacy policy and terms: https://samvar.app/privacy

## Keywords (100 chars, comma-separated, no spaces after commas)
`friends,relationships,stay in touch,contacts,crm,reminder,birthday,connection,social,journal,network`

## What's New (v1.0)
First release. Circles, voice-note logging, nudges, openers, weekly review, birthday radar.

## Support & marketing URLs
- Support: `https://samvar.app/support`
- Marketing: `https://samvar.app`
- Privacy policy: `https://samvar.app/privacy`
- Terms (EULA): `https://samvar.app/terms` — also linked from the in-app paywall (guideline 3.1.2)

## Screenshots (required: 6.9" iPhone; optional 6.5" & iPad)
Capture from the simulator with realistic seeded data. One headline per shot, dark-ink text on cream, phone slightly angled.

1. **Today** — "Who to reach out to, every morning" (nudges + birthday radar)
2. **Opener sheet** — "The first line, written for you" (three drafted messages)
3. **Log** — "Just say what happened" (a dictated note → parsed draft with facts)
4. **Person profile** — "Remembers what matters to them" (facts list)
5. **Score + rings** — "See your friendships in rhythm" (score, rings, net connection days)
6. **Network** — "The groups that build themselves" (constellation)

## App Privacy (nutrition label) — answers to give in App Store Connect

Start: **Yes, we collect data from this app** (because note text is sent to our server for AI processing, even though it isn't stored). Then, for each data type:

| Data type | Collected? | Linked to identity? | Used for tracking? | Purpose |
|---|---|---|---|---|
| Contacts → Contacts | **No** — read on device, never sent | — | — | — |
| User Content → Other user content (note text, stored facts, first names, town, employer) | **Yes** | No | No | App functionality |
| Location → Coarse location (address text / "Near me" coordinates sent to OpenStreetMap) | **Yes** | No | No | App functionality |
| Identifiers → Device ID (random ID Samvar generates; RevenueCat app user ID) | **Yes** | No | No | App functionality |
| Purchases → Purchase history (subscription status via RevenueCat) | **Yes** | No | No | App functionality |
| Photos, Calendar, Health, Contacts, Email, Messages, Browsing, Usage data, Diagnostics | No | — | — | — |

"Data not linked to you" for everything; nothing is used for tracking; no third-party advertising. Say **No** to "Do you or your third-party partners use data for tracking".

## App Review notes (paste into "Notes" on the version page)

Samvar keeps all user data on the device; there are no accounts, so no demo login is needed. AI features (understanding a logged note, suggesting a message) send the note text to our server at api.samvar.app, which forwards it to Anthropic's Claude API and returns the result without storing it. Everything is free until the reviewer has added 8 people and logged 3 conversations; after that the paywall offers Samvar Pro with a 7-day free trial (products samvar_pro_monthly / samvar_pro_yearly), which can be exercised with a sandbox account. Contacts access is used to let the user flag people from their address book into circles; only flagged people are saved. Calendar is read-only, to offer to log recent meetings. Camera/Photos are used only when the user adds a photo. The home-screen widget and Siri shortcuts read a small snapshot from the app group. Suggested messages are drafts the user edits and sends themselves via Messages/WhatsApp/Mail; the app never sends anything on its own.

## Pre-submission checklist (App Review)

- [x] Privacy policy, support and terms pages live at samvar.app; URLs in App Store Connect.
- [x] Paywall shows price + period + auto-renew wording, and links to Terms of Use and Privacy Policy (3.1.2).
- [x] Restore Purchases button on the paywall and under You.
- [x] Permission purpose strings for Contacts, Calendar, Camera, Photos, Photo Library Add, Location.
- [x] Export compliance: ITSAppUsesNonExemptEncryption = false.
- [x] No account, so no account-deletion requirement.
- [x] In-app copy no longer claims "everything stays on your phone" without qualification.
- [ ] Both subscriptions "Ready to Submit" in App Store Connect (localisation + review screenshot) and attached to the version.
- [ ] App Privacy answers entered as above.
- [ ] 6.9" iPhone screenshots (6) uploaded.
- [ ] Age rating questionnaire (4+).
- [ ] EU trader status verified (or EU excluded from availability).
- [ ] hello@ / privacy@ samvar.app mailboxes actually receive mail (Cloudflare Email Routing → your Gmail).
- [ ] Version 1.0 build selected; "Manually release" chosen so you pick launch day.
