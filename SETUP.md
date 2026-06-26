# Try SUFFERING GOAT (setup for a friend)

A private, local money dashboard. **It runs entirely on your own Mac — your financial data never leaves your machine and is never sent to me or anyone else.** You're running your own copy.

## What you need
- A Mac (macOS). Python 3 and git ship with Apple's Command Line Tools — if a step says they're missing, run `xcode-select --install` once.
- ~5 minutes.

## 1. Get the app
Open **Terminal** and run:
```
git clone https://github.com/cozykace/goat ~/goat
cd ~/goat
```

## 2. Start it
Double-click **`start.command`** in the `~/goat` folder (or run `python3 server.py`). Keep that window open — closing it stops the app. Then open **http://localhost:5173** in your browser.

## 3. See it with demo data first (no bank needed)
To just look around, connect SimpleFIN's free demo:
```
python3 sync.py setup demo
python3 sync.py
```
Reload the page — you'll see sample accounts and spending. (Type `demo` literally; it uses SimpleFIN's public demo token.)

## 4. Connect your own bank (when ready)
SimpleFIN Bridge (~$15/yr) is the bank connection. Get a **setup token** from your SimpleFIN account, then:
```
python3 sync.py setup <YOUR-TOKEN>
python3 sync.py
```
Your token is saved to `.simplefin` (gitignored, never shared). Toggl time-tracking is optional — drop your API token in a file named `.toggl` and run `python3 toggl_sync.py`.

## 5. Getting updates
When the app gets new features, just open the in-app menu (☰) → **⟳ Update app**. It pulls the latest and reloads — no Terminal needed.

## Your privacy
- Everything under `data/` (balances, transactions, tokens) is **gitignored and stays on your Mac**. It's never committed, never uploaded.
- The app is bound to your machine only (`localhost`). To view it on your phone, use a private network like Tailscale — never expose it to the public internet (there's no login).
