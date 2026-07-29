// Visualizer data layer — the PURE builders behind the D3 scenes (vizConstellation /
// vizFlows / vizRhythm / vizBalance + the date helpers). Loaded from app.js by ANCHOR
// (function-name regex), never line numbers, so this doesn't rot when app.js shifts.
// The D3 drawing layer is eyeballed in the real app; this pins the math the scenes hang
// off — the session-minute accounting especially, which is the one place a naive sum
// would silently double-count a running day total. Fixtures are placeholders only, never
// real bank data.
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").split("\n");
const at = (re) => { const i = src.findIndex((l) => re.test(l)); if (i < 0) throw new Error("anchor " + re); return i; };
// The pure block runs from vizYmd() to the start of the drawing layer — no DOM, no d3.
const code = src.slice(at(/^function vizYmd/), at(/^\/\/ ── The Visualizer's drawing layer/)).join("\n");
const V = eval(code + "\n;({ vizYmd, vizYmdAdd, VIZ_AREAS, VIZ_NODE_CAP, VIZ_FLOW_CAP, vizConstellation, vizFlows, vizRhythm, vizBalance })");

let p = 0, f = 0;
const ok = (n, c) => { c ? p++ : f++; console.log((c ? "  ok  " : "FAIL  ") + n); };

// ── date helpers (local, calendar-correct) ──
ok("vizYmd: epoch → local YMD", V.vizYmd(new Date(2026, 6, 4, 12, 0, 0).getTime()) === "2026-07-04");
ok("vizYmdAdd: crosses a month boundary backward", V.vizYmdAdd("2026-03-01", -1) === "2026-02-28");
ok("vizYmdAdd: crosses a month boundary forward", V.vizYmdAdd("2026-01-31", 1) === "2026-02-01");
ok("vizYmdAdd: zero is identity", V.vizYmdAdd("2026-07-15", 0) === "2026-07-15");

// ── vizConstellation ──
const cSrc = {
  snap: {
    accounts: [{ name: "Checking", balance: 2000 }, { name: "Card", balance: -400 }],
    spending: { categories: [{ key: "food", amount: 300 }, { key: "gas", amount: 100 }] },
    income: { sources: [{ key: "job", source: "Job", amount: 1800, tagged: true }, { key: "gift", source: "Gift", amount: 50, tagged: false }] },
  },
  things: [
    { id: "p1", type: "project", name: "Move" },
    { id: "t1", type: "task", title: "Pack", project: "p1" },
    { id: "t2", type: "task", title: "Loose task" },
    { id: "h1", type: "habit", title: "Water" },
    { id: "r1", type: "routine", name: "Morning" },
    { id: "s1", type: "session", title: "Study" },
    { id: "gone", type: "task", title: "Deleted", deleted: 1 },
  ],
  log: [
    { ts: "2026-07-01", at: 1, itemId: "h1", kind: "done" },
    { ts: "2026-07-02", at: 2, itemId: "h1", kind: "done" },
    { ts: "2026-07-01", at: 3, itemId: "q1", prompt: "Energy?" },
    { ts: "2026-07-02", at: 4, itemId: "q1", prompt: "Energy?" },
    // session minutes: a CUMULATIVE running day total re-logged twice — the day value is
    // the latest-at (75), NOT the sum (30+75). Constellation sizes by summed day totals.
    { ts: "2026-07-05", at: 5, itemId: "s1:time", value: { qty: 30 } },
    { ts: "2026-07-05", at: 6, itemId: "s1:time", value: { qty: 75 } },
    { ts: "2026-07-06", at: 7, itemId: "s1:time", value: { qty: 40 } },
  ],
  charLog: [],
};
const con = V.vizConstellation(cSrc);
const area = (k) => con.areas.find((a) => a.key === k);
const node = (id) => con.nodes.find((n) => n.id === id);   // EXACT id ("area|localId") — a substring match would collide (e.g. "acct1" ends with "t1")
ok("constellation: not empty with real data", !con.empty && con.nodes.length > 0);
ok("constellation: money well counts accounts+spend+TAGGED income (2+2+1=5)", area("money").total === 5);
ok("constellation: untagged income is excluded", !con.nodes.some((n) => n.id.indexOf("in:gift") !== -1));
ok("constellation: a project is sized by 1 + its children (2)", (node("tasks|p1") || {}).value === 2);
ok("constellation: a project-linked task is NOT a loose task node", !node("tasks|t1"));
ok("constellation: a loose task IS its own node", !!node("tasks|t2"));
ok("constellation: tombstoned things are excluded", !node("tasks|gone"));
ok("constellation: habit sized 1 + hits (1+2=3)", (node("habits|h1") || {}).value === 3);
ok("constellation: session summed across days = 75 + 40 = 115 (never 30+75+40)", (node("sessions|s1") || {}).value === 115);
ok("constellation: check-in well holds the answered question", area("journal").total === 1 && (node("journal|q1") || {}).value === 2);
ok("constellation: node weight is normalized to its own well's top (≤1)", con.nodes.every((n) => n.weight >= 0 && n.weight <= 1));
ok("constellation: the biggest node in a well has weight 1", area("money").shown > 0 && con.nodes.filter((n) => n.area === "money").some((n) => n.weight === 1));

// determinism: the same input builds a byte-identical model (no Date.now / Math.random)
ok("constellation: deterministic (same input → same JSON)", JSON.stringify(V.vizConstellation(cSrc)) === JSON.stringify(V.vizConstellation(cSrc)));

// per-area cap: overflow rolls into `hidden`, and shown never exceeds the cap
const many = { snap: { spending: { categories: Array.from({ length: 40 }, (_, i) => ({ key: "c" + i, amount: 100 + i })) } }, things: [], log: [], charLog: [] };
const capd = V.vizConstellation(many).areas.find((a) => a.key === "money");
ok("constellation: shown capped at VIZ_NODE_CAP", capd.shown === V.VIZ_NODE_CAP);
ok("constellation: hidden = total − shown", capd.hidden === capd.total - capd.shown && capd.total === 40);
ok("constellation: caption count reflects ALL, not just shown", capd.total === 40);

// empty cache → honest empty flag
ok("constellation: empty when nothing has activity", V.vizConstellation({ snap: {}, things: [], log: [], charLog: [] }).empty === true);
ok("constellation: zero-value nodes never appear", V.vizConstellation({ snap: { accounts: [{ name: "Z", balance: 0 }] }, things: [], log: [], charLog: [] }).empty === true);

// ── vizFlows (Sankey graph) ──
const fl = V.vizFlows({ income: { sources: [{ key: "job", source: "Job", amount: 1000, tagged: true }], window_days: 30 }, spending: { categories: [{ key: "food", amount: 600 }, { key: "gas", amount: 100 }] } });
const kind = (k) => fl.nodes.filter((n) => n.kind === k);
ok("flows: totals sum correctly", fl.totalIn === 1000 && fl.totalOut === 700);
ok("flows: a hub node exists", kind("hub").length === 1);
ok("flows: income + hub + spend + kept nodes present", kind("in").length === 1 && kind("out").length === 2 && kind("kept").length === 1);
ok("flows: surplus becomes a 'kept' link of the difference (300)", fl.kept === 300 && fl.links.some((l) => l.value === 300));
ok("flows: links reference node INDEXES", fl.links.every((l) => typeof l.source === "number" && typeof l.target === "number"));
ok("flows: window days carried through", fl.windowDays === 30);
// deficit: spent more than came in → the gap is drawn as money you already had, never invented income
const def = V.vizFlows({ income: { sources: [{ key: "job", source: "Job", amount: 500, tagged: true }] }, spending: { categories: [{ key: "rent", amount: 900 }] } });
ok("flows: deficit shows as 'from what you had' (no kept node)", def.kept === -400 && !def.nodes.some((n) => n.kind === "kept") && def.nodes.some((n) => n.name === "from what you had"));
// balanced window → neither kept nor deficit band
const bal = V.vizFlows({ income: { sources: [{ key: "j", source: "J", amount: 500, tagged: true }] }, spending: { categories: [{ key: "x", amount: 500 }] } });
ok("flows: balanced window adds no surplus/deficit band", Math.abs(bal.kept) <= 0.5 && !bal.nodes.some((n) => n.kind === "kept"));
// overflow rolls into ONE honest band
const wide = V.vizFlows({ income: { sources: [{ key: "j", source: "J", amount: 5000, tagged: true }] }, spending: { categories: Array.from({ length: 25 }, (_, i) => ({ key: "c" + i, amount: 100 - i })) } });
ok("flows: spending capped, rest rolled into 'everything else'", kindOf(wide, "out").length <= V.VIZ_FLOW_CAP && wide.nodes.some((n) => n.name === "everything else"));
function kindOf(g, k) { return g.nodes.filter((n) => n.kind === k); }
ok("flows: untagged income excluded from the river", V.vizFlows({ income: { sources: [{ key: "u", source: "U", amount: 999, tagged: false }] }, spending: { categories: [{ key: "f", amount: 10 }] } }).totalIn === 0);
ok("flows: empty when no income and no spend", V.vizFlows({}).empty === true);

// ── vizRhythm (calendar heatmap) ──
const rSrc = {
  log: [
    { ts: "2026-07-28", at: 1, itemId: "q1", prompt: "Energy?" },
    { ts: "2026-07-28", at: 2, itemId: "h1", kind: "done" },
    // running session total re-logged: the DAY's minutes must be the latest (75), so the
    // heatmap adds only the delta (30 then +45), never 30+75.
    { ts: "2026-07-29", at: 3, itemId: "s1:time", value: { qty: 30 } },
    { ts: "2026-07-29", at: 4, itemId: "s1:time", value: { qty: 75 } },
    { ts: "1999-01-01", at: 5, itemId: "old", kind: "done" },   // outside the window → dropped
  ],
  charLog: [{ k: "feat", d: "x", t: new Date(2026, 6, 28, 9).getTime() }],
};
const rh = V.vizRhythm(rSrc, "2026-07-29", 30);
const cell = (y) => rh.days.find((d) => d.ymd === y);
ok("rhythm: window has exactly N days", rh.days.length === 30);
ok("rhythm: window ends on endYmd", rh.days[rh.days.length - 1].ymd === "2026-07-29");
ok("rhythm: a day's count tallies checkins + things + feats", cell("2026-07-28").count === 3 && cell("2026-07-28").checkins === 1 && cell("2026-07-28").feats === 1);
ok("rhythm: session minutes are the latest running total, not the sum (75)", cell("2026-07-29").mins === 75);
ok("rhythm: out-of-window entries are dropped", !rh.days.some((d) => d.ymd === "1999-01-01"));
ok("rhythm: totals aggregate across the window", rh.total >= 4 && rh.active >= 2 && rh.mins === 75);
ok("rhythm: empty when nothing lands in the window", V.vizRhythm({ log: [], charLog: [] }, "2026-07-29", 30).empty === true);

// ── vizBalance (daily line) ──
const bhist = [
  { date: "2026-07-01T10:00:00", total: 100, cash: 50, spend_30d: 200 },
  { date: "2026-07-02T09:00:00", total: 90, cash: 40, spend_30d: 210 },
  { date: "2026-07-02T20:00:00", total: 120, cash: 60, spend_30d: 205 },   // same day, later → wins
  { date: "2026-07-03T10:00:00", total: 140, cash: 70, spend_30d: 205 },
];
const bl = V.vizBalance(bhist);
ok("balance: one point per calendar day (dedup)", bl.points.length === 3);
ok("balance: the later same-day snapshot wins", bl.points[1].total === 120);
ok("balance: change = last.total − first.total", bl.change === 40);
ok("balance: min/max span both series (superseded cash 40 is gone → min 50)", bl.min === 50 && bl.max === 140);
ok("balance: a single day is an honest empty state (no trend from one dot)", V.vizBalance([{ date: "2026-07-01", total: 100, cash: 50 }]).empty === true);
ok("balance: no history at all is empty, never fabricated", V.vizBalance([]).empty === true);
ok("balance: malformed dates are skipped", V.vizBalance([{ date: "nope", total: 1, cash: 1 }, { date: "2026-07-01", total: 100, cash: 50 }]).empty === true);

console.log("\n" + p + " passed, " + f + " failed");   // run.sh reads the count off the LAST line — it must start with the number
process.exit(f ? 1 : 0);
