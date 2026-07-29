/* THE CACHE — demo data layer.
   Loaded BEFORE app.js. Two jobs:
   1. Seed localStorage (brand theme + a curated board + sensible planning numbers)
      so the embed opens looking like a real, lived-in dashboard.
   2. Intercept every backend call (fetch to /api/* and the static data/*.json) and
      answer it with PLAY NUMBERS — so the real app runs with no Python backend and
      no real financial data anywhere. Nothing here is real. */
(function () {
  "use strict";

  window.__CACHE_DEMO__ = true;  // app.js hides cloud-account UI in the demo (no real signups on the instance)

  // ── seed localStorage (only when unset, so a visitor's tweaks/toggles persist) ──
  function seed(k, v) { try { if (localStorage.getItem(k) == null) localStorage.setItem(k, v); } catch (e) {} }
  seed("money.theme", "mono");   // the single default theme we're developing (colors off)
  seed("money.rate", "24");
  seed("money.guaranteedIncome", "1800");
  seed("money.need", "2600");
  seed("money.reserve", "400");
  seed("money.forecastGoal", "4000");
  // a few Things (routines / tasks / events) so the deck AND the calendar demo full — dates
  // ride the visitor's current month so the calendar always looks alive. All made up.
  (function () {
    var dd = new Date(), Y = dd.getFullYear(), M = dd.getMonth();
    function ymd(day) { return Y + "-" + String(M + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0"); }
    function mk(o) { return Object.assign({ updated: Date.now(), ord: 0, ordAt: 0, deleted: 0, parent: null, routine: null }, o); }
    var things = [
      mk({ id: "demo-r1", type: "routine", name: "Morning routine", emoji: "🌅", sched: { freq: "daily", every: 1 } }),
      mk({ id: "demo-r2", type: "routine", name: "Laundry", emoji: "🧺", sched: { freq: "weekly", days: [0] } }),
      mk({ id: "demo-m1", type: "task", title: "Feed the cat", routine: "demo-r1" }),
      mk({ id: "demo-m2", type: "task", title: "Meditate", routine: "demo-r1" }),
      mk({ id: "demo-t1", type: "task", title: "Dentist appointment", emoji: "🦷", due: ymd(9), dueTime: "10:30", done: 0 }),
      mk({ id: "demo-t2", type: "task", title: "Renew library books", emoji: "📚", due: ymd(15), done: 0 }),
      mk({ id: "demo-e1", type: "event", title: "Coffee with Sam", emoji: "☕", start: ymd(12), end: null, allDay: 0, startTime: "15:00", endTime: null }),
      mk({ id: "demo-e2", type: "event", title: "Weekend trip", emoji: "✈️", start: ymd(20), end: ymd(22), allDay: 1, startTime: null, endTime: null }),
      mk({ id: "demo-e3", type: "event", title: "Team standup", emoji: "📞", start: ymd(1), end: null, allDay: 0, startTime: "09:00", endTime: "09:15", sched: { freq: "weekly", days: [1], start: ymd(1) } }),
      // a Session so the Visualizer's Sessions well + Rhythms scene demo full (all made up)
      mk({ id: "demo-s1", type: "session", title: "Deep work", emoji: "🎯", start: ymd(1), end: null, allDay: 1, sched: null }),
    ];
    seed("money.things", JSON.stringify(things));
  })();
  // ── seed a lived-in activity log + character journey so the Visualizer's Constellation,
  //    Rhythms and (via things) Sessions scenes all show PLAY numbers. All fabricated. ──
  (function () {
    function ymdBack(days) { var d = new Date(Date.now() - days * 86400000); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
    var log = [], feats = [], at = 1;
    // a scatter of check-ins + habit ticks + session minutes over the last ~50 days
    for (var i = 50; i >= 0; i--) {
      if (i % 7 === 3) continue;                                  // a few quiet days, so the heatmap isn't a solid block
      var day = ymdBack(i);
      log.push({ ts: day, at: at++, itemId: "energy", prompt: "How's your energy right now?", input: "scale", value: 3 + (i % 3), dest: { kind: "health", target: "energy" } });
      if (i % 2 === 0) log.push({ ts: day, at: at++, itemId: "spend", prompt: "Spend anything today?", input: "amount", value: 10 + (i % 40), dest: { kind: "money", target: "" } });
      if (i % 3 === 0) log.push({ ts: day, at: at++, itemId: "demo-m2", kind: "done", root: "demo-r1" });   // Meditate (a routine member)
      if (i % 4 === 1) { var mins = 25 * (1 + (i % 3)); log.push({ ts: day, at: at++, itemId: "demo-s1:time", kind: "habit", root: "demo-s1", value: { done: 1, qty: mins, unit: "min" } }); }
    }
    // a handful of character feats (charLog speaks epoch MS)
    [2, 9, 16, 23, 30].forEach(function (d, n) { feats.push({ k: n % 2 ? "feat" : "level", d: "A demo milestone", t: Date.now() - d * 86400000 }); });
    seed("money.log", JSON.stringify(log));
    seed("money.charLog", JSON.stringify(feats));
  })();
  // a curated board (key order = stack order on narrow screens)
  var LAYOUT = {
    balance:        { type: "balance",        x: 30,  y: 30,  w: 300, h: 190 },
    incomeforecast: { type: "incomeforecast", x: 350, y: 30,  w: 380, h: 340 },
    safe:           { type: "safe",           x: 30,  y: 240, w: 300, h: 210 },
    worklog:        { type: "worklog",        x: 30,  y: 470, w: 300, h: 250 },
    subscriptions:  { type: "subscriptions",  x: 350, y: 390, w: 380, h: 340 },
    breakdown:      { type: "breakdown",      x: 30,  y: 740, w: 300, h: 290 },
  };
  try { if (localStorage.getItem("money.layout.v2") == null) localStorage.setItem("money.layout.v2", JSON.stringify(LAYOUT)); } catch (e) {}

  // ── play data (all made up) ─────────────────────────────────────────────────
  var now = Date.now();
  var DAY = 86400000;
  var iso = new Date(now).toISOString();
  function ts(daysAgo) { return Math.round((now - daysAgo * DAY) / 1000); } // epoch seconds

  var accounts = [
    { id: "chk", name: "Everyday Checking", org: "Northwind Bank", balance: 2840.55, currency: "USD" },
    { id: "sav", name: "Savings",           org: "Northwind Bank", balance: 5200.00, currency: "USD" },
    { id: "cc",  name: "Rewards Card",       org: "Summit Card",    balance: -420.18, currency: "USD" },
  ];

  var catLabels = {
    groceries: "Groceries", dining: "Eating out", gas: "Gas", shopping: "Shopping",
    music: "Music gear", subscriptions: "Subscriptions", transport: "Transport",
    health: "Health", other: "Other",
  };
  var spendCats = [
    { key: "groceries", amount: 520 }, { key: "dining", amount: 290 },
    { key: "shopping", amount: 250 }, { key: "gas", amount: 210 },
    { key: "other", amount: 190 }, { key: "music", amount: 180 },
    { key: "transport", amount: 120 }, { key: "health", amount: 95 },
    { key: "subscriptions", amount: 96 },
  ];

  var spending = { window_days: 30, total: 1951, per_month: 1951, per_day: 65, trend_pct: -4, categories: spendCats, transfers: 800 };
  var income = {
    window_days: 30, total: 3200, per_month: 3200, untagged: 0,
    sources: [
      { source: "Lakeside Studio", key: "retainer",  amount: 1800, tagged: true },
      { source: "Gig work",        key: "gig",       amount: 980,  tagged: true },
      { source: "Freelance",       key: "freelance", amount: 420,  tagged: true },
    ],
  };
  var subscriptions = {
    window_days: 30, total: 96, per_month: 96,
    items: [
      { name: "Adobe Creative Cloud", key: "adobe",   amount: 54.99, count: 1, descriptions: ["ADOBE CREATIVE CLOUD"], accounts: ["Rewards Card"] },
      { name: "Spotify",              key: "spotify", amount: 11.99, count: 1, descriptions: ["SPOTIFY USA"],          accounts: ["Everyday Checking"] },
      { name: "Toggl",                key: "toggl",   amount: 9.00,  count: 1, descriptions: ["TOGGL TRACK"],          accounts: ["Rewards Card"] },
      { name: "iCloud+",              key: "icloud",  amount: 2.99,  count: 1, descriptions: ["APPLE.COM/BILL"],       accounts: ["Everyday Checking"] },
      { name: "Neighborhood Gym",     key: "gym",     amount: 16.00, count: 1, descriptions: ["RIVERSIDE FITNESS"],    accounts: ["Everyday Checking"] },
    ],
  };

  var summary = {
    period: { kind: "mtd", ym: null, start: ts(25), end: ts(0), days: 25, label: "this month", count: 142 },
    catmeta: { labels: catLabels },
    updated: iso, total: 7620.37, cash: 3260.00, accounts: accounts,
    burn_per_day: 65, spend_window_days: 30,
    spending: spending, income: income, subscriptions: subscriptions,
  };

  var balances = {
    updated: iso, total: 7620.37, cash: 3260.00, burn_per_day: 65, spend_window_days: 30,
    spending: { window_days: 30, total: 1951, per_month: 1951, per_day: 65, trend_pct: -4, categories: spendCats },
    income: income, subscriptions: subscriptions, accounts: accounts,
  };

  var monthly = {
    updated: iso,
    months: [
      { ym: "2026-01", label: "Jan", income: 2800, spending: 2100, net: 700,  count: 128, live: 128, imported: 0, interest: 12.4, ccpay: 80,  categories: [{ key: "groceries", amount: 560 }, { key: "dining", amount: 320 }, { key: "gas", amount: 230 }] },
      { ym: "2026-02", label: "Feb", income: 2950, spending: 1980, net: 970,  count: 121, live: 121, imported: 0, interest: 11.9, ccpay: 80,  categories: [{ key: "groceries", amount: 500 }, { key: "dining", amount: 260 }, { key: "gas", amount: 200 }] },
      { ym: "2026-03", label: "Mar", income: 3100, spending: 2200, net: 900,  count: 139, live: 139, imported: 0, interest: 11.2, ccpay: 100, categories: [{ key: "groceries", amount: 590 }, { key: "dining", amount: 340 }, { key: "gas", amount: 220 }] },
      { ym: "2026-04", label: "Apr", income: 3000, spending: 1850, net: 1150, count: 117, live: 117, imported: 0, interest: 10.6, ccpay: 100, categories: [{ key: "groceries", amount: 480 }, { key: "dining", amount: 240 }, { key: "gas", amount: 190 }] },
      { ym: "2026-05", label: "May", income: 3300, spending: 2050, net: 1250, count: 134, live: 134, imported: 0, interest: 9.8,  ccpay: 120, categories: [{ key: "groceries", amount: 540 }, { key: "dining", amount: 300 }, { key: "gas", amount: 215 }] },
      { ym: "2026-06", label: "Jun", income: 3200, spending: 1951, net: 1249, count: 142, live: 142, imported: 0, interest: 9.1,  ccpay: 120, categories: [{ key: "groceries", amount: 520 }, { key: "dining", amount: 290 }, { key: "gas", amount: 210 }] },
    ],
  };

  // daily snapshots for the Visualizer's "Balance over time" line — a gently climbing
  // total with a payday bump, one entry per day for the last 45 days. All made up.
  var history = (function () {
    var out = [], t = 6400, c = 2900;
    for (var i = 45; i >= 0; i--) {
      t += 18 + (i % 5) * 4 - (i % 3) * 6;                        // a wobbly upward drift
      c += (i % 6 === 0) ? 220 : -14;                             // cash dips between paydays, jumps on them
      var d = new Date(now - i * DAY);
      out.push({ date: d.toISOString(), total: Math.round(t), cash: Math.round(Math.max(400, c)), spend_30d: 1900 + (i % 7) * 20 });
    }
    return out;
  })();

  var work = {
    updated: iso,
    today: { hours: 3.5, earned: 84 },
    week:  { hours: 18.5, earned: 444 },
    month: { hours: 72, earned: 1728 },
    running: { description: "", elapsed_hours: 0 },
    projects_month: [
      { name: "Gig batches",     hours: 40 },
      { name: "Lakeside Studio", hours: 22 },
      { name: "Freelance",       hours: 10 },
    ],
  };

  var categories = {
    categories: [
      { key: "groceries", label: "Groceries", count: 28, builtin: true,  merchants: ["Harvest Market", "Corner Grocer"] },
      { key: "dining",    label: "Eating out", count: 19, builtin: true, merchants: ["Taqueria Sol", "Blue Bottle"] },
      { key: "shopping",  label: "Shopping", count: 12, builtin: false,  merchants: ["Everything Mart"] },
      { key: "gas",       label: "Gas", count: 9, builtin: true,         merchants: ["QuickFill"] },
      { key: "music",     label: "Music gear", count: 5, builtin: false, merchants: ["Sixth String"] },
      { key: "transport", label: "Transport", count: 7, builtin: true,   merchants: ["Metro Transit"] },
      { key: "health",    label: "Health", count: 4, builtin: true,      merchants: ["Riverside Fitness"] },
      { key: "subscriptions", label: "Subscriptions", count: 6, builtin: true, merchants: [] },
      { key: "other",     label: "Other", count: 14, builtin: true,      merchants: [] },
    ],
  };

  var recurring = {
    recurring: [
      { key: "adobe",   name: "Adobe Creative Cloud", amount: 54.99, months: 8, count: 8, avg_gap_days: 30, last: ts(6),  first: ts(220), recent: 54.99, flag: "",        accounts: ["Rewards Card"],       descriptions: ["ADOBE CREATIVE CLOUD"], category: "subscriptions", tagged: true },
      { key: "spotify", name: "Spotify",              amount: 11.99, months: 8, count: 8, avg_gap_days: 30, last: ts(12), first: ts(225), recent: 11.99, flag: "",        accounts: ["Everyday Checking"],  descriptions: ["SPOTIFY USA"],          category: "subscriptions", tagged: true },
      { key: "gym",     name: "Neighborhood Gym",     amount: 16.00, months: 1, count: 1, avg_gap_days: 30, last: ts(4),  first: ts(4),   recent: 16.00, flag: "new",     accounts: ["Everyday Checking"],  descriptions: ["RIVERSIDE FITNESS"],    category: "health",        tagged: false },
      { key: "toggl",   name: "Toggl",                amount: 9.00,  months: 6, count: 6, avg_gap_days: 30, last: ts(9),  first: ts(170), recent: 10.99, flag: "changed", accounts: ["Rewards Card"],       descriptions: ["TOGGL TRACK"],          category: "subscriptions", tagged: true },
    ],
  };

  var transfers = { transfers: [
    { account: "Savings",      dir: "in",  amount: 500, months: 6, count: 6 },
    { account: "Rewards Card", dir: "out", amount: 300, months: 5, count: 5 },
  ] };

  var deposits = { deposits: [
    { source: "Lakeside Studio", key: "retainer",  amount: 1800, status: "income", tagged: true },
    { source: "Gig work",        key: "gig",       amount: 660,  status: "income", tagged: true },
    { source: "Instant cashout", key: "cashout",   amount: 320,  status: "income", tagged: true },
    { source: "Freelance",       key: "freelance", amount: 420,  status: "income", tagged: true },
  ] };

  var merchants = { merchants: [
    { merchant: "Harvest Market", key: "harvest-market", amount: 520, category: "groceries", count: 11, first: ts(28), last: ts(1) },
    { merchant: "Taqueria Sol",   key: "taqueria-sol",   amount: 180, category: "dining",    count: 6,  first: ts(26), last: ts(3) },
    { merchant: "QuickFill",      key: "quickfill",      amount: 210, category: "gas",       count: 4,  first: ts(24), last: ts(2) },
    { merchant: "Sixth String",   key: "sixth-string",   amount: 180, category: "music",     count: 2,  first: ts(20), last: ts(5) },
    { merchant: "Everything Mart", key: "everything-mart", amount: 250, category: "shopping", count: 5, first: ts(22), last: ts(4) },
  ] };

  var averages = { months: 6, income: 3058, spend: 1955, net: 1103, deficit: 0, subscriptions: 95, instacart: 845, per_day: 65 };

  var issues = { issues: [
    { type: "recurring", key: "gym", label: "New recurring charge", detail: "Neighborhood Gym · $16/mo · first seen 4 days ago" },
    { type: "uncategorized", key: "everything-mart", label: "Uncategorized merchant", detail: "Everything Mart · $250 across 5 charges" },
  ] };

  var subs = { subs: {
    "adobe creative cloud": { mustpay: true },
    "spotify": { mustpay: false },
    "toggl": { mustpay: true },
    "icloud+": { mustpay: true },
    "neighborhood gym": { mustpay: false },
  } };

  var incomeLinks = { links: {} };
  // demo Brain Bucket seed — a couple of example held thoughts so the widget demos full
  var demoBucket = [
    { id: "d1", kind: "note", text: "call the dentist about Thursday", url: "" },
    { id: "d2", kind: "note", text: "that budgeting idea from lunch — try it Sunday", url: "" },
  ];
  var demoBucketId = 2;

  // per-month income by source (drives the stacked "streams" forecast view) — keys
  // match the demo's forecast sources (retainer / gig) so history lines up with the sliders
  var incomeMonthly = {
    months: [{ ym: "2026-04", label: "Apr" }, { ym: "2026-05", label: "May" }, { ym: "2026-06", label: "Jun" }],
    sources: [
      { key: "retainer",  name: "Lakeside Studio", monthly: [1800, 1800, 1800], total: 5400 },
      { key: "gig",       name: "Gig work",        monthly: [660, 980, 720],    total: 2360 },
      { key: "freelance", name: "Freelance",       monthly: [400, 0, 420],      total: 820 },
    ],
  };
  var workMonthly = { monthly_hours: { "2026-04": 28, "2026-05": 41, "2026-06": 30 } };

  // ── fetch interceptor ───────────────────────────────────────────────────────
  function J(obj) { return new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } }); }
  function route(url, method, body) {
    var m = (method || "GET").toUpperCase();
    if (url.indexOf("data/balances.json") !== -1) return J(balances);
    if (url.indexOf("data/monthly.json") !== -1) return J(monthly);
    if (url.indexOf("data/history.json") !== -1) return J(history);   // Visualizer: balance-over-time scene
    if (url.indexOf("/api/ping") !== -1) return J({ ok: true });
    if (url.indexOf("/api/manual-account") !== -1) return J({ ok: false, error: "The demo keeps its own books — in your real cache this saves instantly." });
    if (url.indexOf("/api/runway") !== -1) {
      // a payday ~26 days out, so the demo's monthly subs (Adobe due ~24d, Spotify ~18d) land
      // INSIDE the window and the runway sentence shows real play numbers, never a $0 shrug
      var payday = new Date(Date.now() + 26 * 86400000);
      var pymd = payday.getFullYear() + "-" + String(payday.getMonth() + 1).padStart(2, "0") + "-" + String(payday.getDate()).padStart(2, "0");
      return J({ next_deposit: { key: "payroll", source: "Payroll Co", days: 26, amount: 900, ymd: pymd, next: Math.floor(payday.getTime() / 1000) } });
    }
    if (url.indexOf("/api/annuals") !== -1) return J({ annuals: [
      { name: "Summit Card Annual Fee", key: "summit card annual fee", amount: 95, days: 21, confidence: "yearly", when: "Aug 18", last: 0, next: 0 },
      { name: "Domain Renewal", key: "domain renewal", amount: 24, days: 64, confidence: "maybe", when: "Sep 30", last: 0, next: 0 },
    ] });
    if (url.indexOf("/api/downloads") !== -1) return J({ ok: true, downloads: 0 });
    if (url.indexOf("/api/export-data") !== -1) return J({ ok: true, files: {}, exported: 0, count: 0 });
    if (url.indexOf("/api/import-data") !== -1) return J({ ok: true, written: 0, files: [], snapshot: "demo" });
    if (url.indexOf("/api/webdav-push") !== -1) return J({ ok: false, error: "WebDAV isn't available in the demo" });
    if (url.indexOf("/api/webdav-config") !== -1) return J({ ok: true, configured: false, url: "", user: "" });
    if (url.indexOf("/api/devtree") !== -1) return J({ ok: true,
      roadmap: { shipped: 100, in_progress: 5, planned: 30, in_progress_items: ["Cache cloud", "Form builder"], planned_items: ["Beast Mode", "WebDAV backups", "DMs + find friends"] },
      files: [{ file: "app.js", todo: 3, bad: 0, markers: [{ sev: "todo", kind: "TODO", line: 42, text: "// TODO: polish empty state" }] }],
      totals: { todo: 3, bad: 0, files_flagged: 1 } });
    if (url.indexOf("/api/connect-status") !== -1) return J({ connected: true });
    if (url.indexOf("/api/summary") !== -1) return J(summary);
    if (url.indexOf("/api/work-monthly") !== -1) return J(workMonthly);
    if (url.indexOf("/api/integrity") !== -1) return J({ ok: true, count: 142, backups: 8, last_backup: "2026-06-26", checks: [
      { name: "ledger readable", ok: true, detail: "142 transactions" },
      { name: "unique transaction ids", ok: true, detail: "142 ids · 142 unique" },
      { name: "well-formed rows", ok: true, detail: "0 malformed" },
      { name: "no corrupt lines on disk", ok: true, detail: "0 corrupt of 142" },
      { name: "recoverable backup exists", ok: true, detail: "8 backup days" },
    ] });
    if (url.indexOf("/api/work") !== -1) return J(work);
    if (url.indexOf("/api/income-monthly") !== -1) return J(incomeMonthly);
    if (url.indexOf("/api/categories") !== -1) return J(categories);
    if (url.indexOf("/api/recurring") !== -1) return J(recurring);
    if (url.indexOf("/api/transfers") !== -1) return J(transfers);
    if (url.indexOf("/api/deposits") !== -1) return J(deposits);
    if (url.indexOf("/api/other-merchants") !== -1 || url.indexOf("/api/merchants") !== -1) return J(merchants);
    if (url.indexOf("/api/statistics") !== -1) return J({ ok: true, months: 9, stats: [
      { label: "Months tracked", value: "9" },
      { label: "Avg income", value: "$5,200/mo", tone: "ok" },
      { label: "Avg spending", value: "$3,900/mo", tone: "bad" },
      { label: "Avg net", value: "+$1,300/mo", tone: "ok" },
      { label: "Savings rate", value: "25%", tone: "ok" },
      { label: "Spend / day", value: "$130" },
      { label: "Subscriptions", value: "$210/mo" },
      { label: "Best month", value: "Apr 2026 · +$2,100", tone: "ok" },
      { label: "Leanest month", value: "Dec 2025 · −$400", tone: "bad" },
      { label: "Top category", value: "Groceries · $4,600" },
      { label: "Biggest expense", value: "$1,200 · Rent" },
      { label: "Transactions", value: "1,284" },
      { label: "Lifetime in", value: "$46,800", tone: "ok" },
      { label: "Lifetime out", value: "$35,100", tone: "bad" },
    ] });
    if (url.indexOf("/api/averages") !== -1) return J(averages);
    if (url.indexOf("/api/issues") !== -1) return J(issues);
    if (url.indexOf("/api/deleted") !== -1) return J({ ok: true, deleted: [] });   // demo starts with nothing deleted
    if (url.indexOf("/api/undelete-txn") !== -1) return J({ ok: true, restored: true });
    if (url.indexOf("/api/income-links") !== -1) {
      // stateful: the widget re-GETs, merges its one change, POSTs the map back and
      // adopts it — a static route would make the second link erase the first
      if (m === "POST") { try { incomeLinks.links = JSON.parse(body || "{}").links || {}; } catch (e) {} return J({ ok: true, links: incomeLinks.links }); }
      return J(incomeLinks);
    }
    if (url.indexOf("/api/subs") !== -1) return J(m === "POST" ? { ok: true, subs: subs.subs } : subs);
    if (url.indexOf("/api/match-count") !== -1) return J({ count: 8, total: 210 });
    if (url.indexOf("/api/categorize") !== -1) return J({ ok: true, spending: summary.spending });
    if (url.indexOf("/api/income") !== -1) return J({ ok: true, income: summary.income });
    if (url.indexOf("/api/category") !== -1) return J({ ok: true, categories: categories.categories });
    if (url.indexOf("/api/delete-txn") !== -1) return J({ ok: true });
    if (url.indexOf("/api/bug-status") !== -1) return J({ ok: true, bugs: [] });
    if (url.indexOf("/api/bug") !== -1) return J({ ok: true, bugs: [] });
    if (url.indexOf("/api/import") !== -1) return J({ ok: false, error: "Import isn’t available in the demo." });
    if (url.indexOf("/api/sync") !== -1) return J({ ok: true, updated: iso, transactions: 0, ledger: {} });
    if (url.indexOf("/api/connect") !== -1) return J({ ok: false, error: "This is the live demo — connect a real bank in your own copy of THE CACHE." });
    if (url.indexOf("/api/update-check") !== -1) return J({ ok: true, available: false, current: "demo" });
    if (url.indexOf("/api/update") !== -1) return J({ ok: true, changed: false, message: "The demo is always up to date." });
    if (url.indexOf("/api/restart") !== -1) return J({ ok: true });
    return J({ ok: true });
  }

  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    // the demo's bug button shouldn't actually email — fake a success so it looks live
    if (url.indexOf("web3forms.com") !== -1) return Promise.resolve(J({ success: true, message: "demo" }));
    // …and it shouldn't write to the real beta feedback inbox either (no spam vector)
    if (url.indexOf("/api/collections/feedback/") !== -1) return Promise.resolve(J({ ok: true, demo: true }));
    // check-in sync: the demo has no backend — answer with an empty shared log/deck so the
    // demo stays purely local (rev 0 can never overwrite a visitor's local deck)
    if (url.indexOf("/api/checkin-deck") !== -1) return Promise.resolve(J({ ok: true, deck: { rev: 0, items: [] } }));
    if (url.indexOf("/api/checkin-log") !== -1) return Promise.resolve(J({ ok: true, log: [] }));
    if (url.indexOf("/api/checkin") !== -1) return Promise.resolve(J({ ok: true, added: 0 }));
    // Brain Bucket: a small in-memory bucket so adds + tosses feel real (resets on reload)
    if (url.indexOf("/api/bucket-remove") !== -1) {
      try { var rid = JSON.parse((init && init.body) || "{}").id; demoBucket = demoBucket.filter(function (it) { return it.id !== rid; }); } catch (e) {}
      return Promise.resolve(J({ ok: true, items: demoBucket }));
    }
    if (url.indexOf("/api/bucket") !== -1) {
      if ((((init && init.method) || "GET") + "").toUpperCase() === "POST") {
        try { var bb = JSON.parse((init && init.body) || "{}"); demoBucket.push({ id: "d" + (++demoBucketId), kind: bb.kind || "note", text: bb.text || "", url: bb.url || "" }); } catch (e) {}
      }
      return Promise.resolve(J({ ok: true, items: demoBucket }));
    }
    if (url.indexOf("/api/") !== -1 || url.indexOf("data/balances.json") !== -1 || url.indexOf("data/monthly.json") !== -1 || url.indexOf("data/history.json") !== -1) {
      var method = (init && init.method) || (typeof input === "object" && input && input.method) || "GET";
      return Promise.resolve(route(url, method, init && init.body));
    }
    if (realFetch) return realFetch(input, init);
    return Promise.reject(new Error("offline"));
  };
})();
