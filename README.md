# Multipleazka 🏎️

A 2-player, real-time **multiplication race** game. One phone/laptop plays as
**Kids** (numbers 1–10), the other as **Parent** (numbers 1–12). Both cars race
on a shared, live-synced track — first to the finish line wins!

Built for **Azka** 💙 — the Kids player gets spoken cheers and personalized
encouragement; the Parent player gets a quiet, harder track.

## Files
- `index.html` — page structure (4 screens) + Firebase CDN scripts
- `style.css` — all styling, responsive for phone + laptop
- `script.js` — game logic, Firebase sync, and text-to-speech

## How it works
1. **Role screen** — each player picks Parent or Kids.
2. **Pairing** — Player 1 taps *Create Game* → gets a 6-char code. Player 2
   enters that code to join (synced through Firebase Realtime Database).
3. **Race** — each player answers multiple-choice questions. Every correct
   answer moves their car forward. Kids need **10** correct; Parent needs
   **~50** (each Parent step is 1/5 of a Kids step).
4. **Winner** — first car to the finish line wins.

## ⚙️ One-time setup: add your Firebase config (required for multiplayer)
The game needs a free Firebase Realtime Database to sync the two devices.

1. Go to <https://console.firebase.google.com> and **Add project** (any name).
2. In the left menu: **Build → Realtime Database → Create Database →
   Start in test mode** (fine for family use).
3. Click the ⚙️ **Project settings → Your apps → Web (`</>`)**, register the app.
4. Copy the `firebaseConfig` object it shows you.
5. Open `script.js` and replace the placeholder `firebaseConfig` near the top
   with your real values. Make sure `databaseURL` is included.

> Test-mode rules expire after 30 days. To keep it open for family use, set the
> Realtime Database rules to `{"rules":{".read":true,".write":true}}` (fine for a
> private game; not for sensitive data).

## Run locally
Open `index.html` directly in a browser, or serve the folder:
```bash
npx serve .
```
Open the URL on two devices (or two browser tabs) to test the 2-player race.

## Notes
- Text-to-speech uses the browser's built-in `SpeechSynthesis` (Kids role only).
  Some mobile browsers require one tap before audio is allowed — the first
  answer tap satisfies that.
