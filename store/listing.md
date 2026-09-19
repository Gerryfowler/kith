# Samvar — App Store listing (draft v1)

## Identity
- **App name** (30 max): `Samvar`
- **Subtitle** (30 max): `Keep your people close`
- **Bundle ID**: `app.samvar.ios` (change if you register a different domain)
- **Primary category**: Lifestyle · **Secondary**: Productivity
- **Age rating**: 4+ (no objectionable content; questionnaire all "No")
- **Price**: Free to download; one auto-renewing subscription "Samvar Pro" (monthly £4.99 / yearly £29.99, placeholders) with a 7-day free introductory offer on both. No free tier.
- **Seller**: Gerry Fowler (individual account; migrate to a company later via App Store Connect → Agreements)

## Promotional text (170 max, editable without a new build)
The friendships you'd hate to lose, quietly kept alive. Samvar tells you who's slipping, remembers what matters to them, and drafts the first line.

## Description (4000 max)
Most of us don't lose friends on purpose. We just go quiet — a busy month becomes a year, and the people who matter drift out of rhythm.

Samvar is a small, calm app that keeps that from happening.

**Put your people in circles.** Inner circle, Invest, Keep warm. Each has its own natural rhythm — weekly, monthly, a few times a year — and Samvar watches the gaps so you don't have to.

**Just talk.** After a coffee, a call, a long walk — dictate a sentence or two. Samvar works out who you saw, who reached out, how deep it went, and files the things worth remembering: their kid's name, the marathon they're training for, the job interview on Thursday.

**Reach out today.** Every morning, a handful of gentle nudges: who's fading, whose birthday is Thursday, who reached out last time so it's your turn, two friends who'd love each other but have never met. One tap drafts a warm, specific opener from what you actually know about them, and sends it in Messages or WhatsApp.

**See it working.** A connection score that genuinely goes backwards when you go quiet. Rhythm rings for each circle. A weekly goal and streak for meaningful conversations. A constellation of who you see together, and the groups that build themselves from it.

**Private by design.** Your people, notes and history live on your phone. No accounts, no ads, no selling data. Back up to a file whenever you like.

Try everything free for 7 days. Then Samvar is £4.99 a month or £29.99 a year — about the price of one coffee with a friend.

— 
Samvar Pro is an auto-renewing subscription with a 7-day free trial. Payment is charged to your Apple ID account at confirmation of purchase. The subscription renews automatically unless cancelled at least 24 hours before the end of the current period. Manage or cancel in Settings → Apple ID → Subscriptions. Privacy policy and terms: https://samvar.app/privacy

## Keywords (100 chars, comma-separated, no spaces after commas)
`friends,relationships,stay in touch,contacts,crm,reminder,birthday,connection,social,journal,network`

## What's New (v1.0)
First release. Circles, voice-note logging, nudges, openers, weekly review, birthday radar.

## Support & marketing URLs
- Support: `https://samvar.app/support`
- Marketing: `https://samvar.app`
- Privacy policy: `https://samvar.app/privacy` (required — see site/privacy.html)

## Screenshots (required: 6.9" iPhone; optional 6.5" & iPad)
Capture from the simulator with realistic seeded data. One headline per shot, dark-ink text on cream, phone slightly angled.

1. **Today** — "Who to reach out to, every morning" (nudges + birthday radar)
2. **Opener sheet** — "The first line, written for you" (three drafted messages)
3. **Log** — "Just say what happened" (a dictated note → parsed draft with facts)
4. **Person profile** — "Remembers what matters to them" (facts list)
5. **Score + rings** — "See your friendships in rhythm" (score, rings, streak)
6. **Network** — "The groups that build themselves" (constellation)

## App Privacy (nutrition label) — declare honestly
- Data **not collected** by the developer: everything stays on device.
- Pro AI features send the **note text** and stored **facts about people** to Samvar's server, which forwards to Anthropic for processing and does not store them. Declare: *Data used for App Functionality, not linked to identity, not used for tracking.*
- Addresses typed into the app are sent to OpenStreetMap (Nominatim) for geocoding. Declare under Location → Coarse Location, App Functionality.
- Contacts: read only when the user picks contacts; names/phones stored on device only.
- No third-party analytics or ads SDKs in v1.

## Review notes (for Apple's reviewer)
"Samvar stores all data on device. The app requires the Samvar Pro subscription after a 7-day free trial; in the sandbox, tap Start free trial on the first screen to unlock it. Then add three people on the People tab, and on Log type 'Coffee with Sarah this morning, I organised it, long chat about her new job' and tap Review & score. Nudges appear on Today."

## Pre-submission checklist
- [ ] Apple Developer Program enrolment approved
- [ ] Domain registered; privacy + support pages live
- [ ] App icon 1024×1024 PNG (no alpha) uploaded — from branding/icon.svg
- [ ] Subscription products created in App Store Connect (monthly, yearly) + intro offer
- [ ] Paid Apps agreement signed, bank + tax forms complete
- [ ] Test on a real iPhone via TestFlight (notifications, contacts, sms: links)
- [ ] Sign in with Apple: not needed (no accounts)
- [ ] Export compliance: uses only HTTPS → "No" to proprietary encryption
