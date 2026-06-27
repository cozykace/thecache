# THE CACHE

A private, local money cockpit. It runs entirely on **your own computer** — your bank data never leaves your machine and is never uploaded anywhere.

> New here and just want to look around? Try the live demo (fake data, nothing to install): **https://cozykace.github.io/thecache/demo/**

---

## Run it yourself (Windows)

You only do steps 1–2 once. After that it's just double-clicking `start.bat`.

### 1. Install Python (one time)
1. Go to **https://www.python.org/downloads/** and click the big **Download Python** button.
2. Run the installer. **Important:** on the first screen, check the box **“Add python.exe to PATH”**, then click **Install Now**.

### 2. Get THE CACHE
**Easiest:** on the GitHub page click the green **Code** button → **Download ZIP**. Then right-click the downloaded zip → **Extract All**.
**Or with git:** `git clone https://github.com/cozykace/thecache.git`

### 3. Start it
- Open the extracted `thecache` folder and **double-click `start.bat`**.
- A black window opens (that's the app running — leave it open) and your browser opens to **http://localhost:5173**.
- If the page looks blank for a second, just refresh.

That's it — the app is running. To stop it, close the black window. To start it again later, double-click `start.bat`.

> If `start.bat` doesn't work, open the folder in a terminal and run `py server.py` (or `python server.py`).

---

## Get your money in — pick any of these

Click **Connect** in the app (left sidebar) to find these options.

**A. Just explore first** — you can run the app with no data and click around. Widgets will say “no data” until you connect or import. Totally fine to start here.

**B. Connect your bank (live data, recommended)**
1. Make an account at **https://bridge.simplefin.org** (~$15/yr — it’s what keeps your bank login safe; the app never sees your bank password).
2. In SimpleFIN, connect your bank(s).
3. Click **New app connection** — it shows a long **setup token**.
4. Paste that token into the **Connect** dialog in THE CACHE and hit connect. It syncs your last ~90 days and saves everything locally.

**C. Import a CSV** — export a transactions CSV from your bank’s website, then in the **Connect** dialog click **Import a bank CSV** (or just drag the `.csv` onto the board). No SimpleFIN account needed.

---

## Your privacy

- Everything runs at `127.0.0.1` (your computer only) — it is **not** reachable from the internet.
- All data lives in a local `data/` folder that is **never committed or uploaded**.
- Your SimpleFIN connection and any secrets stay on your machine.

## Mac

Double-click `start.command` (or run `python3 server.py`), then open http://localhost:5173.

---

Built by Cozy · [thecache.app](https://thecache.app)
