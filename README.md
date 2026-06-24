# Macro Meter

A daily macro tracker (calories / protein / carbs / fat) built as an installable iPhone PWA.
Log by meal, browse history on a calendar, and use GPT‑5.4 to estimate macros from a text
description **or a photo of your food**. Everything is stored locally in your phone's browser.
Your OpenAI key is saved only on your device and is sent **only** to api.openai.com.

## Deploy to GitHub Pages

1. Create a new repository (e.g. `macros`).
2. Upload **all** files in this folder to the repo root (index.html, app.js, sw.js,
   manifest.webmanifest, the icon PNGs). Keep them flat — don't nest them in a subfolder.
3. Repo **Settings → Pages**: Source = "Deploy from a branch", Branch = `main`, Folder =
   `/ (root)`. Save.
4. Wait ~1 minute, then open `https://YOURNAME.github.io/macros/` on your iPhone in Safari.

All paths are relative, so it works from a project subpath (`/macros/`) or a root domain.

## Install on your iPhone

Safari → **Share** → **Add to Home Screen**. It launches full‑screen and works offline
(logging works without signal; AI + barcode lookups need a connection).

## First‑run setup

Open **Settings**:
- Paste your OpenAI API key (platform.openai.com → API keys), tap **Test key**.
- Pick a model — nano (cheapest), mini (better photo accuracy), or 5.5 (most accurate).
- Set **Training‑day** and **Rest‑day** targets, the default day type, and units.

## Features

- **By‑meal logging** with a calorie ring + protein/carbs/fat gauges vs. your targets.
- **Training vs. rest day targets** — toggle the day type at the top of Today; the rings switch
  to that day's targets. Optionally auto‑set rest days when calories burned fall below a
  threshold (Settings).
- **AI estimates** from a typed description, the **🎤 mic** (voice), or a **photo**. Always
  editable before saving; star to save a food for one‑tap re‑adding.
- **✨ What can I eat?** — sends your *remaining* macros to GPT and suggests foods that fit.
- **Barcode scan (⧉ Scan tab)** — point the camera at a package; looks it up in the free
  Open Food Facts database and prefills the macros. You can also type the barcode number.
- **Copy a meal (⧉ on any meal)** — pull a previous day's breakfast/lunch/etc. into today.
- **Calendar history** + 7‑day averages, **body‑weight trend** sparkline, and a **logging
  streak**.
- **Coach** chat that knows today's totals, targets, and day type.
- **JSON backup / restore** in Settings.

### Notes on a couple of features
- **Voice**: uses the browser's speech recognition. iOS Safari support is inconsistent — if it
  doesn't work, the keyboard's built‑in 🎤 dictation key does the same thing into the box.
- **Barcode**: loads a small scanner library from a CDN the first time (needs internet) and
  asks for camera permission. If a product isn't found, type the macros in manually.

## Apple Health sync (iOS Shortcut) — steps + active energy

The app reads values from the URL, so a Shortcut can push your Health data in:

```
https://YOURNAME.github.io/macros/?steps=12000&burned=600
```

Optional params: `&weight=172.5` and `&date=2026-06-23` (defaults to today). On open, the app
writes them to that day and cleans the URL. Test it now with **Settings → Simulate a sync**.

**Build the Shortcut**
1. Shortcuts app → **+** → name it "Sync Macros".
2. **Find Health Samples** → Sample Type **Steps**, date range **Today**.
3. **Calculate Statistics** → Operation **Sum**, over the samples' values. (This is your step
   total — leave it as a variable.)
4. **Find Health Samples** → Sample Type **Active Energy**, **Today**.
5. **Calculate Statistics** → **Sum** (your burned kcal).
6. **Text** action: `https://YOURNAME.github.io/macros/?steps=[Steps Sum]&burned=[Energy Sum]`
   — insert the two Calculate Statistics results as variables. (Decimals are fine; the app
   rounds them.)
7. **Open URLs** action → the Text.
8. Run it. Optionally add a **Personal Automation** (Automation tab → Time of Day, e.g. 9 PM →
   run this Shortcut) so it syncs daily.

**One important iOS gotcha — read this.** A Home‑Screen‑installed PWA keeps its storage
*separate* from Safari. So a Shortcut that opens the URL may land the data in Safari's copy of
the app instead of your installed icon. Most reliable options:
- **Easiest:** just type the two numbers into Today — it's quick, and it's the only method
  that's 100% reliable regardless of how iOS routes the link.
- **For auto‑sync:** use the app as a normal Safari tab (don't add to Home Screen). Then the
  Shortcut's URL open shares the same storage and merges automatically.
- If you want both the installed icon *and* sync, run the Shortcut and, when the link opens,
  make sure it opens in the same place you normally use the app.

## Updating the app later

If you change any file, bump `CACHE` in `sw.js` (e.g. `macro-meter-v3`) so phones pull the new
version instead of the cached one.
