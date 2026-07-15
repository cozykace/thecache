# Try THE CACHE (setup for a friend)

A private, local money dashboard (**thecache.app**). **It runs entirely on your own Mac — your financial data never leaves your machine and is never sent to me or anyone else.** You're running your own copy.

## What you need
- A Mac (macOS). Python 3 and git ship with Apple's Command Line Tools — if a step says they're missing, run `xcode-select --install` once.
- ~5 minutes.

## 1. Get the app
Open **Terminal** and run:
```
git clone https://github.com/cozykace/thecache ~/thecache
cd ~/thecache
```

## 2. Start it
Double-click **`start.command`** in the `~/thecache` folder (or run `python3 server.py`). Keep that window open — closing it stops the app. Then open **http://localhost:5173** in your browser.

## 3. Connect (all in the app — no Terminal)
In the app, open the menu (**☰**) → **⚡ Connect a bank**. It walks you through it:
- **Just looking?** Hit **Load demo data** — sample accounts, no bank, free.
- **Your own bank?** Make a **SimpleFIN Bridge** account (~$15/yr) at [bridge.simplefin.org](https://bridge.simplefin.org), connect your bank there, click **New app connection** to get your **setup token**, then paste it into the app and hit **Connect**.

Your setup token is *yours alone* — never share it. It's exchanged for a read-only link saved to `.simplefin` on **your** Mac (gitignored, never uploaded). The app never sees your bank login.

Toggl time-tracking is optional — drop your API token in a file named `.toggl` and run `python3 toggl_sync.py`.

## 4. See it on your phone — sign in and it syncs itself
Your cache has an optional **cloud account** that carries your data to your other devices, **end-to-end encrypted** (the server only ever holds a sealed blob it can't read). This is the easy way onto your phone:
1. On your **Mac**, open the menu (**☰**) → **Settings → ☁️ Cache cloud** → **Create account** (or **Log in**) with an email + password. *(Heads-up: this isn't on the main screen — it lives in Settings.)*
2. Connect your bank (step 3 above) — your Mac seals your data and pushes it up automatically.
3. On your **phone**, open **[thecache.app](https://thecache.app)** and **Log in** with the same account — your cache is there. Add it to your home screen for one-tap check-ins.

Editing (categorizing, connecting banks) stays on your Mac; the phone is a read-only window for now.

*Prefer to keep everything on your own hardware, no cloud at all? You can instead reach your Mac from your phone over a private [Tailscale](https://tailscale.com) tailnet (`tailscale serve 5173`) — nothing is ever exposed to the public internet.*

## 5. Getting updates
You installed with `git clone`, so updates are one tap: menu (**☰**) → **⟳ Update app** pulls the latest and reloads — no Terminal. *(If you ever set up from a downloaded ZIP instead of cloning, there's no git history to pull — just grab the newest ZIP from [Releases](https://github.com/cozykace/thecache/releases) when you want to update.)*

## Your privacy
- Everything under `data/` (balances, transactions, tokens) is **gitignored and stays on your Mac**. It's never committed to git.
- Your bank setup token and bank data never leave your Mac. If you turn on **Cache cloud**, only an **encrypted** copy syncs — sealed on your device with a key the server never sees, so it can't read your finances.
