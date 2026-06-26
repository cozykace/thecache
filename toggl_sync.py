#!/usr/bin/env python3
"""
Toggl sync — pulls your time entries and writes data/toggl.json for the
"Time worked" widget. Stdlib only, no installs.

Handles RUNNING timers correctly (elapsed = now - start) so a live timer never
blows the hours up (Toggl's own summary miscounts these). Token lives in
.toggl (gitignored, chmod 600).

Run:  python3 toggl_sync.py
"""
import os
import json
import base64
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN_FILE = os.path.join(HERE, ".toggl")
OUT = os.path.join(HERE, "data", "toggl.json")
API = "https://api.track.toggl.com/api/v9"
UA = "thecache/1.0"


def _token():
    with open(TOKEN_FILE) as f:
        return f.read().strip()


def _get(path):
    auth = base64.b64encode((_token() + ":api_token").encode()).decode()
    req = urllib.request.Request(API + path,
                                 headers={"Authorization": "Basic " + auth, "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def _parse(ts):
    return datetime.fromisoformat((ts or "").replace("Z", "+00:00"))


def _hours(e, now):
    """Correct duration in hours. Completed = its duration; running (no stop) =
    now - start, so a live timer reads as real elapsed time, not 56 years."""
    dur = e.get("duration")
    if e.get("stop") and dur is not None and dur >= 0:
        return dur / 3600.0
    try:
        return max(0.0, (now - _parse(e.get("start"))).total_seconds() / 3600.0)
    except Exception:
        return max(0.0, (dur or 0) / 3600.0) if (dur or 0) > 0 else 0.0


def run():
    now = datetime.now(timezone.utc)
    local = datetime.now()
    entries = _get("/me/time_entries?start_date=%s&end_date=%s" % (
        (local - timedelta(days=90)).strftime("%Y-%m-%d"),
        (local + timedelta(days=1)).strftime("%Y-%m-%d")))
    me = _get("/me")
    wid = me.get("default_workspace_id")
    projects = {}
    try:
        for p in (_get("/workspaces/%s/projects" % wid) or []):
            projects[p.get("id")] = p.get("name")
    except Exception:
        pass

    today0 = local.replace(hour=0, minute=0, second=0, microsecond=0)
    week0 = today0 - timedelta(days=today0.weekday())   # Monday
    month0 = today0.replace(day=1)

    today_h = week_h = month_h = 0.0
    proj_month = {}
    monthly_h = {}   # {"YYYY-MM": hours} — history for the forecast effort overlay
    running = None
    for e in entries or []:
        h = _hours(e, now)
        try:
            st = _parse(e.get("start")).astimezone().replace(tzinfo=None)
        except Exception:
            continue
        if not e.get("stop"):
            running = {"description": (e.get("description") or "").strip(), "elapsed_hours": round(h, 2)}
        mk = st.strftime("%Y-%m")
        monthly_h[mk] = monthly_h.get(mk, 0.0) + h
        if st >= today0:
            today_h += h
        if st >= week0:
            week_h += h
        if st >= month0:
            month_h += h
            pname = projects.get(e.get("project_id")) or "No project"
            proj_month[pname] = proj_month.get(pname, 0.0) + h

    out = {
        "updated": now.isoformat(timespec="seconds"),
        "today_hours": round(today_h, 2),
        "week_hours": round(week_h, 2),
        "month_hours": round(month_h, 2),
        "monthly_hours": {k: round(v, 2) for k, v in monthly_h.items()},
        "running": running,
        "projects_month": sorted(({"name": k, "hours": round(v, 2)} for k, v in proj_month.items()),
                                 key=lambda x: -x["hours"]),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f, indent=2)
    os.replace(tmp, OUT)
    try:
        os.chmod(OUT, 0o600)
    except OSError:
        pass
    print("✓ Toggl: today %.1fh · week %.1fh · month %.1fh%s" % (
        today_h, week_h, month_h, " · timer running" if running else ""))
    return out


if __name__ == "__main__":
    run()
