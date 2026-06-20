# Your Data — you own it

All your financial data lives as **plain JSON in `data/`, on this machine only.**
It's gitignored, so it never goes to GitHub or any server. You can open any file
in a text editor and read or export it forever — with or without this app. No
lock-in, no service holding your data.

## Files (in `data/`)

| File | What it is |
|------|------------|
| `ledger.json` | **Every transaction ever synced**, deduped by id. The permanent record — grows forever, never shrinks. |
| `transactions.json` | The recent ~30-day working window (powers spending + breakdown). |
| `balances.json` | Latest snapshot the dashboard reads (balances, income, spending, the gap). |
| `history.json` | One snapshot per day — for trends over time. |
| `synclog.json` | A log of every sync (time + counts). |
| `categories.json` | Your saved category overrides (what you teach it). |
| `toggl.json` | A snapshot of your Toggl info. |
| `.simplefin` *(repo root)* | Your **read-only** bank access credential (chmod 600). |

## Backups — 100% local

- **Automatic:** every sync writes a dated snapshot to `backups/<date>/`.
- **Manual:** run `python3 backup.py` to snapshot right now.
- **Off-machine safety (your call):** drag the `backups/` (or `data/`) folder to an
  external drive or iCloud, or let **Time Machine** cover it. Nothing leaves your
  Mac unless *you* move it.

## Restore

Copy the JSON files from a `backups/<date>/` folder back into `data/`, then reload
the dashboard. That's it.
