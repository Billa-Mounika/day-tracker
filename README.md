# Day Timeline Tracker (Offline PWA)

A responsive, offline-first day timeline tracker with:
- 8 categories: Work, Cooking, Commute, Kids, Study, Rest, Exercise, Social
- One running activity at a time (tap to switch)
- Timeline + edit blocks + notes
- Stats (today)
- Idle reminder + Wind-up reminder

## Run locally (fastest)
Because PWA + Service Worker requires HTTPS or localhost, use a tiny local server.

### Option A: Python
```bash
cd day-timeline-pwa
python3 -m http.server 8000
```
Open: http://localhost:8000

### Option B: Node
```bash
npx serve .
```

## Install on iPhone (as an app)
1) Open the hosted URL in **Safari**
2) Tap **Share** → **Add to Home Screen**
3) Open from the new icon
4) Tap **Enable Reminders** and allow notifications

## Hosting (so you can use it daily)
- GitHub Pages (static hosting)
- Netlify / Vercel (static site)
- Any HTTPS static server

Just upload all files in this folder.

## Reminder note
This version schedules reminders while the app is running (and will show notifications best when installed as a PWA).
If you want guaranteed reminders even when the app is completely closed, you can add a push server later (VAPID).
The Service Worker already includes a push handler stub.
# day-tracker
# day-tracker
