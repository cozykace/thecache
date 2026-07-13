# THE CACHE — project manager (check-in protocol)

This is the playbook for the **cache check-in**: a fast, honest standup that tells Cozy where THE CACHE
stands and, above all, the **one obvious next baby step**. Any Claude session — typed by hand
("cache check-in") or the scheduled standup — produces the briefing by following this file.

**Why this exists:** solo passion projects sprawl. The backlog is 150+ items deep. The job of this
check-in is to cut through that and get Cozy back on task in under a minute of reading.

---

## How to run it

1. **Read the live state** (always re-read; never answer from memory):
   - `Working Docs/3_ROADMAP.md` — the lanes. The **NOW lane is the accountability spine**: the briefing's "What's next" MUST report progress against NOW before anything else.
   - `BACKLOG.md` — the source of truth for asks. `[x]` shipped · `[~]` in progress · `[ ]` open. Items tagged **BIG** / **north-star** / **FLAGSHIP** / **PRIORITY** matter most.
   - `FEATURES.md` — the shipped, product-facing list + **The promise** (the north-star in one paragraph).
   - `git log --oneline -15` — the real changelog (commit subjects = what actually shipped, newest first).
   - `CLAUDE.md` — conventions + "Where context lives" (north-star lives in agent memory: `money-vision`, plus BACKLOG items tagged north-star).
2. **Feedback triage (every check-in).** Read `data/bugs.json` for new/open entries (Cozy's own in-app reports — NEVER quote financial data) and ask Cozy for anything new in the beta feedback inbox (the `feedback` collection on PocketHost — he can paste, or a session with API access can fetch). Every new report becomes a BACKLOG item or an explicit "not doing, because" — nothing dies in an inbox.
3. **Optionally** scan `git log --since="7 days ago"` and the source for fresh `TODO/FIXME/NEXT` markers (mirrors the Dev Tree widget) if doing a deeper weekly pass.
4. **Produce the briefing** in the exact shape below.
5. **Never print real financial data** (counterparty names, dollar amounts, account numbers). This is a process doc — keep it placeholder-clean. Counts and feature names only.

---

## The briefing format (always this shape)

> **Cache check-in — <date>**

**1. Where it stands** *(status snapshot — 3-5 lines max)*
- Shipped recently: the last 2-3 commit subjects, in plain English.
- In flight (`[~]`): name each in-progress thread + its one-line state (e.g. "Cache cloud — P1 live, P2 next").
- The numbers: `N shipped · M in progress · K open` (from the checkbox counts).

**2. What's next** *(the 1-3 highest-leverage moves — not the whole list)*
- Pick from `[~]` first (finish what's started before opening new threads — Cozy's "brick by brick" rule).
- Then the most leveraged `[ ]` items: prefer ones that **unblock others** (e.g. the cloud/membership backend unlocks DMs, family profiles, minigames, Community Cache) or that move the **north-star** (cache-as-character → Community Cache → wealth-redistribution).
- For each: one line on *why it's worth doing now*.

**3. Dropped threads** *(catch what's slipping)*
- `[ ]` items marked "Requested" with an old date that have never moved — surface 2-3, oldest/most-mentioned first.
- Anything Cozy clearly asked for in recent chats/commits that has **no BACKLOG entry** — flag it so it gets logged (and offer to add it).
- Be honest but kind: this is a safety net, not a guilt trip.

**4. Still pointed at the north-star?** *(alignment gut-check — 1-2 lines)*
- The north-star: a **calm, playful, provably-private life cockpit** where doing real-life work levels up your cache-as-character, opening onto the **Community Cache** (opt-in, end-to-end-encrypted, wealth-redistribution so managing your life can pay you back). King Cozy = primary user.
- Say plainly whether the recent work serves that, or has drifted into polish/side-quests. If drifting, say so.

**5. The one baby step** *(ALWAYS close with this — rendered BIG)*
- Choose the single most obvious, smallest, highest-leverage action Cozy can take **right now** to move the most important thing forward. Smallest real brick, not a project.
- Render it as a big heading so it's impossible to miss:

```
# 👉 DO THIS NEXT
## <one concrete baby step, ~10 words>
```

---

## Tone & rules

- **Concise and direct.** Cozy prefers accuracy over hand-holding; cut every word you can. Prose over walls of bullets where it reads better.
- **Honest.** If something's been stuck for weeks, or a thread is drifting from the north-star, say it plainly.
- **One next step, not ten.** The whole point is to *reduce* decision load. The briefing ends with exactly one big action.
- **Lightweight.** Don't rewrite the backlog or propose big speculative plans unless asked — just orient and point.
- **Offer, don't auto-do.** End by offering to (a) start the baby step, (b) log any dropped ask into BACKLOG.md, or (c) go deeper on any section.

---

## Maintenance

- This protocol is the PM's brain. To change how the check-in behaves (cadence, what it emphasizes, the format), edit this file — both the on-demand trigger and the scheduled standup read it fresh each run.
- The on-demand trigger is registered in `CLAUDE.md` (Workflow section: "cache check-in").
- The scheduled standup lives in Claude's Scheduled tasks (id `cache-standup`); change its cadence there.
