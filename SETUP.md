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

## 4. Use it on your phone (optional, 10 minutes)
Your cache runs on your computer — your phone just needs a private road to it. [Tailscale](https://tailscale.com) (free) builds that road; nothing is ever exposed to the public internet.
1. Install Tailscale on your Mac and on your phone, sign into both with the same account.
2. On the Mac: `tailscale serve 5173` (leave the app running as usual).
3. On your phone, open the address Tailscale gives you — that's your cache, live. Add it to your home screen and the daily check-in is one tap away.

## 5. Getting updates
When the app gets new features, just open the in-app menu (☰) → **⟳ Update app**. It pulls the latest and reloads — no Terminal needed.

## Your privacy
- Everything under `data/` (balances, transactions, tokens) is **gitignored and stays on your Mac**. It's never committed, never uploaded.
- The app is bound to your machine only (`localhost`). To view it on your phone, use a private network like Tailscale — never expose it to the public internet (there's no login).
