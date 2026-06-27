# THE CACHE — Help & Learn

Welcome to your cache. This guide lives inside the app and updates over time — check back as new features land.

## Getting started
- **Connect a bank** (Menu → ⚡ Connect a bank) to pull real balances + transactions automatically, read-only, via SimpleFIN. It never sees your bank password.
- **No bank yet?** Load demo data or import a CSV statement from the same panel to try everything first.
- **Name your cache** — click the name at the top of the menu and call it whatever you want. It's yours.
- **Set your reserve** (Settings → Safety buffer) — the cushion you never want to dip below.

## The board & widgets
Your dashboard is a board of widgets you arrange freely. Open the **Widget Library** (in the menu) and click any widget to add or remove it.
- **Total balance** — your cash across accounts, at a glance.
- **Income forecast** — slide to plan future income. Two modes: **streams** (each source stacked over time, with your real history) and **cushion** (your savings climbing toward a goal).
- **Safe to spend** — what's truly spendable after your reserve, plus your daily burn and runway.
- **Money Map** — the one place you define what everything is: tag which deposits count as income, and star the bills you must pay.
- **Where it's going** — spending by category.
- **Budget** — set your plan and see what you need to earn.
- **Money flow** — a visual map of how money moves between your accounts.
- **Time worked** — your hours (from Toggl) paired with what actually landed in your bank.

**Tidy & spacing:** Menu → Tidy layout cleans up your board in place. The **Gutter** slider sets the spacing between widgets. Drag any widget by its header; resize from the corners.

## Your cache as a character
Your cache levels up as you do the work — every interaction earns EXP.
- **Click the character card** to see your level, your **journey** (a tech tree of arcs and feats), your **skills & unlocks**, and your activity ledger.
- **Cache health** — the badge under your character shows how fully connected your cache is. Max it out (connect your bank, tag income, star must-pays, set your reserve) for a **+10% EXP bonus on every click** — and watch your cursor go gold (blessed clicks ✨).

## Privacy & your data
- **Local-first.** Your financial data lives on *your* machine. Never on a server, never in the cloud.
- The **🔒 Private & verified** badge runs a live, non-destructive check that your ledger is readable, complete, uncorrupted, and recoverable. Nothing about you leaves your computer.
- **Anonymous usage sharing** is opt-in (Settings) and never sends your financial data — only which widgets you use, so the app can improve.

## Modes & customization
- **Mode** (Settings → Mode): **Smooth Brain** keeps it simple, **Big Brain** is standard, **Galaxy Brain** shows every button.
- **Themes & Fonts** (Settings) — make the whole look yours.
- **Favorites** — star any widget or dock item to pin it to the top.

## Accessibility
Menu → **♿ Accessibility**. We're building this out over time — what's here now:
- **Motion & flashing** — *Reduce* calms the warp, removes the white flash, and stops looping animation (seizure-safe). *System* follows your device's "reduce motion" setting automatically; *Full* keeps every effect.
- **Contrast** — *High* strengthens borders and text for easier reading.
- **Text & UI size** — scale the whole interface up (*Large* / *Largest*).

Need something we don't have yet? Menu → ⚑ Report a bug or request — it goes straight to the team.

## Keeping it updated
Menu → **Update app** previews exactly what's changing (and the download size) before you pull. Nothing happens until you choose; you can skip an update with no nagging.

## FAQ
- **Is my money data safe?** Yes — it never leaves your machine, and a full-history check confirms no data is ever shared.
- **Do I need the internet?** Only to sync your bank and grab updates. The app itself runs locally.
- **Something looks broken?** Menu → ⚑ Report a bug or request — it comes straight to the team.

## Developer Center — build your own
THE CACHE itself is proprietary (the visuals, animations, and code are the author's art — please don't copy them). But the **approach** is something we're happy to share, for tinkerers who want to build their own private, local-first money tool:
- **Local-first architecture** — a tiny local server (Python's standard library is enough) serves a browser UI at `localhost`. Your data lives in plain files on your machine; nothing goes to a server you don't control.
- **Bank data** — [SimpleFIN](https://www.simplefin.org) is a read-only way to pull balances + transactions without handing over your bank login. You connect with a one-time setup token.
- **The pattern that makes it trustworthy** — one canonical data layer that every part of the UI reads from, atomic + crash-durable writes, an append-only ledger, and automatic local backups. (We go deep on this in future Developer Center entries.)
- **No build step required** — plain HTML/CSS/JS + a stdlib server is genuinely enough to get far.

More guides coming. If you build something cool with this approach, we'd love to hear about it — cozy@cozyace.com.

