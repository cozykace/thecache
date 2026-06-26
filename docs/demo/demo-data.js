/* THE CACHE — demo data layer.
   Loaded BEFORE app.js. Two jobs:
   1. Seed localStorage (brand theme + a curated board + sensible planning numbers)
      so the embed opens looking like a real, lived-in dashboard.
   2. Intercept every backend call (fetch to /api/* and the static data/*.json) and
      answer it with PLAY NUMBERS — so the real app runs with no Python backend and
      no real financial data anywhere. Nothing here is real. */
(function () {
  "use strict";

  // ── seed localStorage (only when unset, so a visitor's tweaks/toggles persist) ──
  function seed(k, v) { try { if (localStorage.getItem(k) == null) localStorage.setItem(k, v); } catch (e) {} }
  seed("money.theme", "cache");
  seed("money.rate", "24");
  seed("money.guaranteedIncome", "1800");
  seed("money.need", "2600");
  seed("money.reserve", "400");
  seed("money.forecastGoal", "4000");
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
      { ym: "2026-01", label: "Jan", income: 2800, spending: 2100, net: 700,  count: 128, live: 128, imported: 0, categories: [{ key: "groceries", amount: 560 }, { key: "dining", amount: 320 }, { key: "gas", amount: 230 }] },
      { ym: "2026-02", label: "Feb", income: 2950, spending: 1980, net: 970,  count: 121, live: 121, imported: 0, categories: [{ key: "groceries", amount: 500 }, { key: "dining", amount: 260 }, { key: "gas", amount: 200 }] },
      { ym: "2026-03", label: "Mar", income: 3100, spending: 2200, net: 900,  count: 139, live: 139, imported: 0, categories: [{ key: "groceries", amount: 590 }, { key: "dining", amount: 340 }, { key: "gas", amount: 220 }] },
      { ym: "2026-04", label: "Apr", income: 3000, spending: 1850, net: 1150, count: 117, live: 117, imported: 0, categories: [{ key: "groceries", amount: 480 }, { key: "dining", amount: 240 }, { key: "gas", amount: 190 }] },
      { ym: "2026-05", label: "May", income: 3300, spending: 2050, net: 1250, count: 134, live: 134, imported: 0, categories: [{ key: "groceries", amount: 540 }, { key: "dining", amount: 300 }, { key: "gas", amount: 215 }] },
      { ym: "2026-06", label: "Jun", income: 3200, spending: 1951, net: 1249, count: 142, live: 142, imported: 0, categories: [{ key: "groceries", amount: 520 }, { key: "dining", amount: 290 }, { key: "gas", amount: 210 }] },
    ],
  };

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
      { key: "adobe",   name: "Adobe Creative Cloud", amount: 54.99, months: 8, count: 8, avg_gap_days: 30, last: ts(6),  first: ts(220), recent: ts(6),  flag: "",        accounts: ["Rewards Card"],       descriptions: ["ADOBE CREATIVE CLOUD"], category: "subscriptions", tagged: true },
      { key: "spotify", name: "Spotify",              amount: 11.99, months: 8, count: 8, avg_gap_days: 30, last: ts(12), first: ts(225), recent: ts(12), flag: "",        accounts: ["Everyday Checking"],  descriptions: ["SPOTIFY USA"],          category: "subscriptions", tagged: true },
      { key: "gym",     name: "Neighborhood Gym",     amount: 16.00, months: 1, count: 1, avg_gap_days: 30, last: ts(4),  first: ts(4),   recent: ts(4),  flag: "new",     accounts: ["Everyday Checking"],  descriptions: ["RIVERSIDE FITNESS"],    category: "health",        tagged: false },
      { key: "toggl",   name: "Toggl",                amount: 9.00,  months: 6, count: 6, avg_gap_days: 30, last: ts(9),  first: ts(170), recent: ts(9),  flag: "changed", accounts: ["Rewards Card"],       descriptions: ["TOGGL TRACK"],          category: "subscriptions", tagged: true },
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
  function route(url, method) {
    var m = (method || "GET").toUpperCase();
    if (url.indexOf("data/balances.json") !== -1) return J(balances);
    if (url.indexOf("data/monthly.json") !== -1) return J(monthly);
    if (url.indexOf("/api/ping") !== -1) return J({ ok: true });
    if (url.indexOf("/api/connect-status") !== -1) return J({ connected: true });
    if (url.indexOf("/api/summary") !== -1) return J(summary);
    if (url.indexOf("/api/work-monthly") !== -1) return J(workMonthly);
    if (url.indexOf("/api/work") !== -1) return J(work);
    if (url.indexOf("/api/income-monthly") !== -1) return J(incomeMonthly);
    if (url.indexOf("/api/categories") !== -1) return J(categories);
    if (url.indexOf("/api/recurring") !== -1) return J(recurring);
    if (url.indexOf("/api/transfers") !== -1) return J(transfers);
    if (url.indexOf("/api/deposits") !== -1) return J(deposits);
    if (url.indexOf("/api/other-merchants") !== -1 || url.indexOf("/api/merchants") !== -1) return J(merchants);
    if (url.indexOf("/api/averages") !== -1) return J(averages);
    if (url.indexOf("/api/issues") !== -1) return J(issues);
    if (url.indexOf("/api/income-links") !== -1) return J(m === "POST" ? { ok: true, links: {} } : incomeLinks);
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
    if (url.indexOf("/api/update") !== -1) return J({ ok: true, changed: false, message: "The demo is always up to date." });
    if (url.indexOf("/api/restart") !== -1) return J({ ok: true });
    return J({ ok: true });
  }

  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    // the demo's bug button shouldn't actually email — fake a success so it looks live
    if (url.indexOf("web3forms.com") !== -1) return Promise.resolve(J({ success: true, message: "demo" }));
    if (url.indexOf("/api/") !== -1 || url.indexOf("data/balances.json") !== -1 || url.indexOf("data/monthly.json") !== -1) {
      var method = (init && init.method) || (typeof input === "object" && input && input.method) || "GET";
      return Promise.resolve(route(url, method));
    }
    if (realFetch) return realFetch(input, init);
    return Promise.reject(new Error("offline"));
  };
})();
