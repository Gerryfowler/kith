# Samvar launch marketing plan (v1, 2026-09-26)

## Who we are selling to

Primary (your call, and it's right): **men 30–50 with families at home, on iPhone.** The insight that sells: they didn't choose to lose touch, life just filled up. The product promise: one nudge a day and the first line written for you.

Two adjacent audiences worth a test cell each, because they convert well on this promise:

- **Recent movers / new parents** — the moment friendships actually go quiet. Life-event targeting exists on Meta ("recently moved", "new parents").
- **Fitness-tracker people** — Strava, Whoop, Apple Fitness+, parkrun. They already understand rings, streaks and scores, so "build friendships like your fitness" lands instantly.

Keep the audience UK-first for the first two weeks (English copy, £ pricing, and you can read the comments), then add US, Australia, Canada, Ireland.

## Which platform first

**Start with Apple Search Ads, then Instagram/Facebook. Skip X and YouTube for now.**

| Channel | Why / why not | Order |
|---|---|---|
| **Apple Search Ads** (Basic) | Only channel with real install attribution and no SDK in the app. Highest intent: people typing "stay in touch with friends", "personal CRM", "friendship app". Cheap to start (£5/day). | 1 |
| **Instagram + Facebook** (Meta Ads Manager) | Best creative tooling and the only place where "dads 30–50, iPhone, UK" is a click. Run it as a **website conversion** campaign to samvar.app, not an app-install campaign: app-install ads need Meta's SDK in the app, which would change your privacy label and add tracking you've promised not to do. | 2 |
| Reddit | Cheap, and r/daddit, r/AskMenOver30, r/running are exactly the audience. Ads are text-plus-image, so the creatives here work. Worth £5/day after Meta shows which headline wins. | 3 |
| TikTok | Good for the "dad" angle with talking-head video, but needs you on camera. Later. | 4 |
| X | Weak for app installs, poor iOS targeting, hostile comments. Skip. | – |
| YouTube | Needs video and larger budgets to learn anything. Skip until you have a 20-second screen-recording ad. | – |

## Budget and what "working" looks like

- Weeks 1–2: £10/day Apple Search Ads + £15/day Meta. About £350 total.
- Success bar: **cost per install under £3 on Apple Search Ads**, and **under £4 per install on Meta** (read from App Store Connect campaign links). Trial-start rate above 25% of installs. If a creative beats those in a week, double its budget; if it misses by 2x, kill it.
- Because the app is free-to-start with a 7-day trial and £4.99/month, you need roughly one paying subscriber per £15 spent to break even in month one. Don't judge before day 14.

## What runs where

### Apple Search Ads (Basic)
- Campaign 1 "Brand & intent", UK, £10/day: keywords `friendship app`, `stay in touch with friends`, `personal crm`, `relationship tracker`, `keep in touch app`, `birthday reminder friends`, `contact reminder`, `friends reminder`.
- Let it use the App Store screenshots. No creative needed.
- Turn on "Search Match" for the first week to discover phrases, then move the good ones into exact match.

### Meta (Instagram Feed, Reels, Stories, Facebook Feed)
- Objective: **Traffic**, destination = your App Store page via an App Store **campaign link** (App Store Connect → App Analytics → Campaigns), one link per ad set, e.g. `ct=meta-dads-a`. App Store Connect then reports installs and trials per link without any tracking SDK.
- Don't use Meta's "App promotion" objective: it needs Meta's SDK in the app, which would change your privacy label and add the tracking you've promised not to do.
- Audience A "Dads": Men 30–50, UK, iOS devices only, interests Parenting + Fatherhood + (Strava or Apple Watch or Running).
- Audience B "Movers": Men and women 28–45, UK, iOS only, life event "Recently moved" or "New parents".
- Audience C "Broad": Men 28–55, UK, iOS only, no interests. Meta's own optimisation often beats hand-picked interests.
- Creatives: `marketing/creatives/`, square for feeds, story for Reels and Stories. Launch with A (quiet) and D (dads); B (fitness) and C (first line) as the second wave.
- Copy: `marketing/ad-copy.md`.

### samvar.app on launch day
- Swap the "Coming soon" badge for the official App Store badge linking to the live listing. I'll do this the moment you have the URL.

## Organic, free, and worth more than the ads in month one

- **Founder post on LinkedIn and Facebook** the day it goes live: the personal story ("I built this because I'd gone quiet on people I love"). This will be your best-converting content.
- **Product Hunt** launch on a Tuesday, two weeks after the App Store release once early reviews exist.
- **Reddit organic**: an honest "I made this" post in r/daddit and r/SideProject, asking for feedback, not installs.
- **Ask the first 20 users for App Store reviews** in person. Ratings drive Apple Search Ads conversion more than anything else.

## Measurement without tracking users

- Apple Search Ads reports installs and, via App Store Connect, trial starts and proceeds.
- Meta reports clicks and cost; App Store Connect "App Analytics → Campaigns" shows installs and proceeds per campaign link, so cost per install = Meta spend ÷ those installs.
- RevenueCat shows trials, conversions and churn.

## What I need from you

1. **Apple Search Ads**: sign in at ads.apple.com with your Apple developer account, accept the terms, add a payment card. Then tell me and I'll build the campaign in your browser.
2. **Meta**: create a Facebook Page called "Samvar" and an Instagram business account (@samvar.app if free), then business.facebook.com → Ads Manager → add a payment card. Tell me and I'll build the campaigns, audiences and upload the creatives.
3. **Tell me when Apple approves.** I'll create the campaign links in App Store Connect, update samvar.app, and switch the campaigns on.
4. Optional but powerful: **one photo of you** and two sentences on why you built it, for the founder ad and the LinkedIn post.
5. Confirm the **first-week budget** (I've assumed £25/day total).
