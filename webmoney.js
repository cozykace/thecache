// THE CACHE — browser money engine (the web app's own sync engine, for CSV import).
//
// The hosted web app used to be a READ-ONLY mirror: money entered the vault only from a
// desktop running store.py. This file changes that — it is a faithful JS port of the
// CORE of store.py so a browser with only a cloud account can take in a bank CSV, compute
// its own ledger + core views, and seal the result into the same encrypted vault.
//
// ⚠️ THE ONE RULE (Cozy, 2026-07-24): REUSE the money data contract. This engine must
// produce the SAME ledger.jsonl / balances.json (snapshot) shapes store.py produces, so
// web-imported data and desktop data are interoperable in one vault. The contract is
// VALUE-for-value (parsed-equal), not raw-byte-equal: the two ledgers agree on the parsed
// transaction set and every computed number, but the on-disk .jsonl bytes can differ
// (JS JSON.stringify renders a whole-dollar amount as "50" and drops separator spaces,
// Python json.dumps renders "50.0" with ", "/": " — and our ids are djb2 vs sha1). The
// merge path compares by PARSED key-union, never bytes, so that's harmless. The parity
// tests (tests/webmoney_parity.py) are the correctness anchor — they compare parsed values:
// a money engine that disagrees with the desktop on any VALUE is a bug, not a variant.
// Every function below mirrors a named store.py function — keep them in lockstep.
//
// PORTED (the core money views): categorize (+ categories.json/catmeta remap),
//   prettifyMerchant, the income heuristic, merge_ledger (append + dedupe by key + honor
//   deleted.json tombstones), subscription_items, build_snapshot, categories_from_txns,
//   resolve_period + period_summary, rebuild_from_ledger, and the CSV importer.
// DEFERRED for v1 (stubbed / left to the desktop's canonical recompute on the next sync):
//   monthly history rollup (monthly.json), coverage (coverage.json), detect_recurring /
//   recurring_transfers / the heavy /api views. Spending, safe-to-spend, income and
//   categories all work from a CSV; absolute balance (total/cash) still needs a bank sync,
//   exactly as on the desktop (a CSV carries no live balance).
(function () {
  "use strict";

  // ── Python-compatible rounding ───────────────────────────────────────────────
  // store.py uses round(), which is round-HALF-TO-EVEN (banker's) on the TRUE value of the
  // double. JS Math.round is half-UP (2.5→3 vs Python's 2), and multiplying by 10^nd first
  // (the naive fix) introduces error that misreads near-half values (2.675 is really
  // 2.67499… so Python gives 2.67, not 2.68). So round on the double's exact decimal
  // string instead — this matches CPython's dtoa-based round() bit-for-bit at our magnitudes.
  function pyRound(x, nd) {
    nd = nd || 0;
    if (!isFinite(x)) return x;
    var neg = x < 0; if (neg) x = -x;
    var s = x.toFixed(Math.min(100, nd + 25));   // exact decimal to well past the cut point
    var dot = s.indexOf(".");
    var digits = s.replace(".", "");
    var cut = dot + nd;                            // index one past the last kept digit
    var keep = digits.slice(0, cut), rest = digits.slice(cut);
    var roundUp = false;
    if (rest.length) {
      var first = rest.charCodeAt(0) - 48;
      if (first > 5) roundUp = true;
      else if (first === 5) {
        if (/[1-9]/.test(rest.slice(1))) roundUp = true;                    // >½ → up
        else roundUp = (keep.length ? (keep.charCodeAt(keep.length - 1) - 48) % 2 === 1 : false);   // exactly ½ → to even
      }
    }
    var val = keep === "" ? 0 : parseInt(keep, 10);
    if (roundUp) val += 1;
    var result = val / Math.pow(10, nd);
    return neg ? -result : result;
  }
  function round2(x) { return pyRound(x, 2); }

  // ── category rules (mirror store.CATEGORY_RULES — first match wins) ──────────
  var CATEGORY_RULES = [
    ["housing", ["rent", "apartment", "property mgmt", "mortgage", "landlord", "leasing"]],
    ["subscriptions", ["spotify", "netflix", "hulu", "adobe", "apple.com", "patreon",
      "disney", "youtube", "dropbox", "notion", "openai", "anthropic", "claude"]],
    ["utilities", ["electric", "water util", "pg&e", "utility", "sewer", "sewage",
      "trash", "waste mgmt", "gas company", "power company", "con ed",
      "duke energy", "internet", "comcast", "xfinity", "spectrum"]],
    ["bills", ["at&t", "verizon", "t-mobile", "insurance", "phone bill", "wireless", "mint mobile"]],
    ["transport", ["uber", "lyft", "shell", "chevron", "exxon", "gas ", "fuel", "parking",
      "transit", "bart", "metro", "toll", "arco", "76 "]],
    ["groceries", ["trader joe", "whole foods", "safeway", "grocery", "market", "aldi",
      "kroger", "costco", "sprouts", "ralphs", "wegmans", "publix"]],
    ["dining", ["restaurant", "cafe", "coffee", "starbucks", "chipotle", "doordash",
      "uber eats", "grubhub", "mcdonald", "pizza", "taco", "sushi", "tavern",
      "brewing", "dunkin", "peet", "diner", "kitchen", "grill"]],
    ["music_art", ["guitar", "sam ash", "blick", "vinyl", "sweetwater", "reverb", "music", "art supply"]],
    ["health", ["pharmacy", "cvs", "walgreens", "gym", "fitness", "doctor", "medical", "dental", "clinic"]],
    ["entertainment", ["cinema", "theater", "movie", "ticketmaster", "steam ", "playstation",
      "xbox", "nintendo", "concert", "bar "]],
    ["shopping", ["amazon", "target", "walmart", "etsy", "ebay", "best buy", "store", "shop"]],
    ["fees", ["fee", "atm", "interest charge", "overdraft", "service charge"]],
    ["transfer", ["transfer", "zelle", "venmo", "cash app", "paypal", "withdrawal",
      "online payment", "autopay", "ach ", "bill pay",
      "pymt", "e-payment", "epayment", "payment thank you", "card payment",
      "credit card payment", "web pmt", "pmt thank"]],
  ];
  var NOT_INCOME = ["fee", "waiv", "interest", "refund", "reversal", "adjustment",
    "rebate", "redemption", "mobile pymt", "mobile payment", "returned"];
  var INCOME_HINTS = ["instacart", "shipt", "dasher", "doordash", "payroll",
    "direct dep", "gusto", "deel", "adp "];

  // ── _clean: reduce a raw description to merchant words (mirror store._clean) ──
  var _CLEAN_WORDS = ["pos", "debit", "credit", "card", "purchase", "payment", "ach",
    "recurring", "online", "www", "com", "usa", "the",
    "visa", "mastercard", "amex", "discover", "mc"];
  function _clean(desc) {
    var d = (desc || "").toLowerCase().replace(/[^a-z& ]/g, " ");
    for (var i = 0; i < _CLEAN_WORDS.length; i++) {
      d = d.replace(new RegExp("\\b" + _CLEAN_WORDS[i] + "\\b", "g"), " ");
    }
    return d.replace(/\s+/g, " ").trim();
  }

  // ── prettifyMerchant (mirror store.prettify_merchant) ────────────────────────
  var _PRETTY_PREFIX = new RegExp(
    "^(?:" +
    "purchase\\s+authorized\\s+on\\s+\\d+|" +
    "recurring\\s+payment\\s+authorized\\s+on\\s+\\d+|" +
    "(?:payment|pmt)\\s+authorized\\s+on\\s+\\d+|" +
    "web\\s+authorized\\s+(?:pmt|payment)?|" +
    "external\\s+(?:withdrawal|deposit)|" +
    "pos\\s+(?:debit|purchase)|debit\\s+card\\s+purchase|" +
    "checkcard\\s*\\d*|check\\s*card|" +
    "ach\\s+(?:debit|credit)|" +
    "(?:bill|online|electronic)\\s+payment" +
    ")\\b", "i");
  // These four are keyed by USER-DERIVED tokens (bank descriptions). A plain {} would
  // let an inherited Object.prototype name — "constructor" is the one all-lowercase
  // member that survives token-stripping — read truthy and silently drop the word (or
  // mis-title it), diverging from store.py where a Python dict/tuple has no such member.
  // Null-prototype maps match the Python set/tuple semantics exactly.
  var _PRETTY_DROP = Object.assign(Object.create(null), {
    sp: 1, wp: 1, tst: 1, sq: 1, pp: 1, fs: 1, dbt: 1, crd: 1, ckcd: 1, pos: 1, dda: 1,
    visa: 1, mastercard: 1, amex: 1, discover: 1, mc: 1, debit: 1, credit: 1, card: 1,
    purchase: 1, payment: 1, pmt: 1, pymt: 1, authorized: 1, auth: 1, recurring: 1,
    web: 1, ach: 1, ppd: 1, ccd: 1, indn: 1, des: 1, xxxxx: 1,
    llc: 1, inc: 1, corp: 1, ltd: 1, subscription: 1, subscr: 1,
  });
  var _US_STATES = Object.create(null);
  ("al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt " +
    "ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc").split(" ")
    .forEach(function (s) { _US_STATES[s] = 1; });
  var _ACRONYMS = Object.assign(Object.create(null), { ai: "AI", fka: "FKA", usa: "USA", us: "US", uk: "UK", sf: "SF", nyc: "NYC" });
  function _capitalize(w) { return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w; }
  function prettifyMerchant(raw, fallback) {
    fallback = fallback || "";
    var s = (raw || "").trim().replace(_PRETTY_PREFIX, " ");
    var toks = s.split(/[^A-Za-z&]+/).filter(function (w) { return w && !_PRETTY_DROP[w.toLowerCase()]; });
    var dedup = [];
    for (var i = 0; i < toks.length; i++) {   // collapse consecutive repeats
      if (!dedup.length || dedup[dedup.length - 1].toLowerCase() !== toks[i].toLowerCase()) dedup.push(toks[i]);
    }
    while (dedup.length && _US_STATES[dedup[dedup.length - 1].toLowerCase()]) dedup.pop();   // drop trailing state code
    while (dedup.length > 1 && dedup[dedup.length - 1].length === 1) dedup.pop();             // drop stray trailing single letters
    if (!dedup.length) return fallback || (raw || "").trim().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    return dedup.map(function (w) { return _ACRONYMS[w.toLowerCase()] || _capitalize(w); }).join(" ");
  }

  function isIncome(desc) {
    var d = (desc || "").toLowerCase();
    for (var i = 0; i < NOT_INCOME.length; i++) if (d.indexOf(NOT_INCOME[i]) !== -1) return false;
    return true;
  }

  // ── categorize (mirror store.categorize) ─────────────────────────────────────
  // overrides: {substring: category}; remap: {deletedKey: targetKey} (catmeta fold-ins).
  function _resolveRemap(cat, remap) {
    var seen = 0;
    while (remap && Object.prototype.hasOwnProperty.call(remap, cat) && seen < 12) { cat = remap[cat]; seen++; }
    return cat;
  }
  // the rot-proof matching form (mirror store._norm_match): drop reference-code tokens,
  // then _clean to merchant words — two bank formats of the SAME counterparty normalize alike
  function _normMatch(s) {
    var toks = (s || "").toLowerCase().split(/\s+/).filter(function (t) { return t && !_isRefcode(t); });
    return _clean(toks.join(" "));
  }
  var _NORMKEY_MEMO = Object.create(null);   // override-key → normalized words (categorize runs per-txn in hot loops; null-proto so a key named "constructor" can't poison it)

  function categorize(desc, overrides, remap) {
    var d = (desc || "").toLowerCase();
    var cat = "other", matched = false, k;
    if (overrides) {
      var subs = Object.keys(overrides);
      // pass 1 — RAW substring match (legacy keys keep working forever, byte-for-byte)
      for (var si = 0; si < subs.length; si++) {
        var sub = subs[si];
        var words = sub.split(/\s+/).filter(function (w) { return w.length >= 3; });
        if (words.length && words.every(function (w) { return d.indexOf(w) !== -1; })) { cat = overrides[sub]; matched = true; break; }
      }
      if (!matched) {
        // pass 2 — NORMALIZED fallback (Money Truth Brick 2; mirror store.categorize):
        // survives the bank reformatting descriptions mid-year. Read-time only.
        var dn = _normMatch(d);
        if (dn) {
          for (var ni = 0; ni < subs.length; ni++) {
            var sub2 = subs[ni];
            var key = _NORMKEY_MEMO[sub2];
            if (key === undefined) {
              key = _NORMKEY_MEMO[sub2] = _normMatch(sub2).split(" ").filter(function (w) { return w.length >= 3; });
            }
            if (key.length && key.every(function (w) { return dn.indexOf(w) !== -1; })) { cat = overrides[sub2]; matched = true; break; }
          }
        }
      }
    }
    if (!matched) {
      outer:
      for (var ci = 0; ci < CATEGORY_RULES.length; ci++) {
        var c = CATEGORY_RULES[ci][0], keys = CATEGORY_RULES[ci][1];
        for (k = 0; k < keys.length; k++) { if (d.indexOf(keys[k]) !== -1) { cat = c; break outer; } }
      }
    }
    return _resolveRemap(cat, remap || {});
  }

  // ── income key + decision (mirror store._income_key / income_decision) ───────
  function _isRefcode(token) {
    if (/\d/.test(token)) return true;
    var letters = token.replace(/[^a-z]/g, "");
    if (letters.length >= 9) {
      var vowels = 0;
      for (var i = 0; i < letters.length; i++) if ("aeiou".indexOf(letters[i]) !== -1) vowels++;
      if (vowels / letters.length <= 0.25) return true;
    }
    return false;
  }
  var _INCOME_DROP = Object.create(null);   // null-proto: "constructor" et al must not read truthy (parity with store.py's tuple)
  ("zelle instant pmt pymt payment from deposit electronic mobile banking transfer ach online " +
    "recurring direct the des id ext web ppd co").split(" ").forEach(function (w) { _INCOME_DROP[w] = 1; });
  function _incomeKey(desc) {
    var kept = [];
    (desc || "").toLowerCase().split(/\s+/).forEach(function (w) {
      if (!w || _isRefcode(w)) return;
      w = w.replace(/[^a-z&]/g, "");
      if (w) kept.push(w);
    });
    var toks = kept.filter(function (w) { return !_INCOME_DROP[w] && w.length >= 2; });
    return toks.join(" ").trim() || "income";
  }
  // Returns [key, isIncome, isTagged]. Precedence: your tag > gig/payroll hint > auto.
  function incomeDecision(desc, incomeOverrides, overrides, remap) {
    incomeOverrides = incomeOverrides || {};
    var key = _incomeKey(desc);
    if (Object.prototype.hasOwnProperty.call(incomeOverrides, key)) {
      var ov = incomeOverrides[key];
      return [key, ov === "income", true];
    }
    var d = (desc || "").toLowerCase();
    for (var i = 0; i < INCOME_HINTS.length; i++) if (d.indexOf(INCOME_HINTS[i]) !== -1) return [key, true, false];
    var auto = categorize(desc, overrides, remap) !== "transfer" && isIncome(desc);
    return [key, auto, false];
  }

  // ── ledger key + tombstones (mirror store._ledger_key / is_deleted) ──────────
  function ledgerKey(t) {
    if (t.id != null && t.id !== "") return String(t.id);
    return String(t.posted) + "|" + String(t.amount) + "|" + String(t.description || "").slice(0, 40);
  }
  function isDeleted(key, tomb) {
    var e = tomb && tomb[key];
    return !!(e && typeof e === "object" && e.deleted);
  }

  // parse a .jsonl string into {key: txn} (mirror store._parse_jsonl_str: skip bad lines)
  function parseJsonl(text) {
    var led = {};
    (text || "").split(/\r?\n/).forEach(function (line) {
      line = line.trim();
      if (!line) return;
      var t;
      try { t = JSON.parse(line); } catch (e) { return; }
      if (t && typeof t === "object") led[ledgerKey(t)] = t;
    });
    return led;
  }
  function serializeJsonl(led) {
    return Object.keys(led).map(function (k) { return JSON.stringify(led[k]); }).join("\n") + (Object.keys(led).length ? "\n" : "");
  }

  // ── merge_ledger (mirror store.merge_ledger) ─────────────────────────────────
  // Append-only accumulate, deduped by key. THE choke point where tombstones are
  // enforced: a deleted txn can never be resurrected. Shrink guard: a merge only ever
  // adds. Takes + returns a {key: txn} object (the caller serializes to .jsonl).
  function mergeLedger(led, txns, tomb) {
    led = led || {};
    tomb = tomb || {};
    txns = (txns || []).filter(function (t) { return !isDeleted(ledgerKey(t), tomb); });
    var out = {}; Object.keys(led).forEach(function (k) { out[k] = led[k]; });
    var before = Object.keys(out).length;
    txns.forEach(function (t) {
      var k = ledgerKey(t);
      if (JSON.stringify(out[k]) === JSON.stringify(t)) return;   // already stored, identical
      out[k] = t;
    });
    if (Object.keys(out).length < before) throw new Error("ledger merge would shrink — aborting to protect data");
    return out;
  }

  // ── spending / income aggregates ─────────────────────────────────────────────
  // categories_from_txns (mirror store.categories_from_txns) — transfers EXCLUDED.
  // (Since the 2026-07-28 honest-burn fix, build_snapshot excludes them too — every
  // spending path now agrees: transfers are never spending, surfaced as a footnote.)
  function categoriesFromTxns(txns, overrides, remap) {
    var cats = Object.create(null);   // null-proto: a category keyed "constructor" must aggregate, not read the inherited fn
    txns.forEach(function (t) {
      var amt = t.amount || 0;
      if (amt < 0) {
        var c = categorize(t.description || "", overrides, remap);
        if (c === "transfer") return;
        cats[c] = (cats[c] || 0) + (-amt);
      }
    });
    return Object.keys(cats).map(function (k) { return { key: k, amount: round2(cats[k]) }; })
      .sort(function (a, b) { return b.amount - a.amount; });
  }

  // top_merchants (mirror store.top_merchants) — all spending grouped by cleaned merchant,
  // biggest first, each with its CURRENT category. Drives the web categorizer's list.
  function topMerchants(txns, overrides, remap, limit) {
    limit = limit || 24;
    var agg = Object.create(null), order = [];   // null-proto: a merchant that _cleans to "constructor" must aggregate, not crash
    (txns || []).forEach(function (t) {
      var amt = parseFloat(t.amount || 0) || 0;
      if (amt >= 0) return;
      var key = _clean(t.description || "") || "unknown";
      var it = agg[key];
      if (!it) {
        it = agg[key] = { merchant: _titleCase(key), key: key, amount: 0,
          category: categorize(t.description || "", overrides, remap), count: 0, first: null, last: null };
        order.push(key);
      }
      it.amount += -amt; it.count += 1;
      var p = t.posted;
      if (p) {
        if (it.first === null || p < it.first) it.first = p;
        if (it.last === null || p > it.last) it.last = p;
      }
    });
    var rows = order.map(function (k) { return agg[k]; });
    rows.forEach(function (r) { r.amount = round2(r.amount); });
    rows.sort(function (a, b) { return b.amount - a.amount; });
    return rows.slice(0, limit);
  }

  // other_merchants (mirror store.other_merchants) — top spends stuck in "other", so the
  // categorizer can offer them a home.
  function otherMerchants(txns, overrides, remap, limit) {
    limit = limit || 14;
    var agg = Object.create(null), order = [];
    (txns || []).forEach(function (t) {
      var amt = parseFloat(t.amount || 0) || 0;
      if (amt >= 0) return;
      if (categorize(t.description || "", overrides, remap) !== "other") return;
      var key = _clean(t.description || "") || "unknown";
      if (agg[key] === undefined) { agg[key] = 0; order.push(key); }
      agg[key] += -amt;
    });
    var rows = order.map(function (k) { return { merchant: _titleCase(k), key: k, amount: round2(agg[k]) }; });
    rows.sort(function (a, b) { return b.amount - a.amount; });
    return rows.slice(0, limit);
  }

  // deposit_sources (mirror store.deposit_sources) — every incoming amount grouped by source
  // with its current income status. Drives the web income tagger.
  function depositSources(txns, incomeOverrides, overrides, remap, limit) {
    limit = limit || 40;
    var agg = Object.create(null), order = [];
    (txns || []).forEach(function (t) {
      var amt = parseFloat(t.amount || 0) || 0;
      if (amt <= 0) return;
      var dec = incomeDecision(t.description || "", incomeOverrides, overrides, remap);
      var key = dec[0];
      if (!agg[key]) {
        agg[key] = { source: prettifyMerchant(key, _titleCase(key)), key: key, amount: 0,
          status: dec[1] ? "income" : "ignore", tagged: dec[2] };
        order.push(key);
      }
      agg[key].amount += amt;
    });
    var rows = order.map(function (k) { return agg[k]; });
    rows.forEach(function (r) { r.amount = round2(r.amount); });
    rows.sort(function (a, b) { return b.amount - a.amount; });
    return rows.slice(0, limit);
  }

  // next_deposit (mirror store.next_deposit) — the paycheck-runway anchor: each income
  // source's rhythm read forward, nearest upcoming deposit wins. Same rules, same output.
  function nextDeposit(txns, incomeOverrides, overrides, remap, now) {
    now = now || Math.floor(Date.now() / 1000);
    var day = 86400;
    var by = Object.create(null), order = [];
    (txns || []).forEach(function (t) {
      var amt = parseFloat(t.amount || 0) || 0, posted = t.posted || 0;
      if (amt <= 0 || !posted) return;
      var dec = incomeDecision(t.description || "", incomeOverrides, overrides, remap);
      if (!dec[1]) return;
      var key = dec[0];
      if (!by[key]) { by[key] = []; order.push(key); }
      by[key].push([posted, amt]);
    });
    var best = null;
    order.forEach(function (key) {
      var rows = by[key]; rows.sort(function (a, b) { return a[0] - b[0]; });
      var posts = rows.map(function (r) { return r[0]; });
      var gaps = [];
      for (var i = 0; i < posts.length - 1; i++) { var g = posts[i + 1] - posts[i]; if (g >= 3 * day) gaps.push(g); }
      if (!gaps.length) return;
      gaps.sort(function (a, b) { return a - b; });
      var med = gaps[Math.floor(gaps.length / 2)];
      if (med > 45 * day) return;
      if (now - posts[posts.length - 1] > Math.max(2 * med, 21 * day)) return;   // silent two cycles — the rhythm is dead
      var nxt = posts[posts.length - 1] + med;
      while (nxt < now) nxt += med;
      var amts = rows.map(function (r) { return r[1]; }).sort(function (a, b) { return a - b; });
      var d = new Date(nxt * 1000);
      var cand = { key: key, source: prettifyMerchant(key, _titleCase(key)), next: nxt,
        ymd: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"),
        days: pyRound((nxt - now) / day), amount: round2(amts[Math.floor(rows.length / 2)]) };
      if (best === null || cand.next < best.next) best = cand;
    });
    return best;
  }

  // annual_predictions (mirror store.annual_predictions) — yearly charges forecast forward
  // so the anniversary stops ambushing Safe-to-spend. Same deterministic rules, same output.
  function annualPredictions(txns, now, limit) {
    now = now || Math.floor(Date.now() / 1000);
    limit = limit || 12;
    var day = 86400;
    var by = Object.create(null), order = [];
    (txns || []).forEach(function (t) {
      var amt = parseFloat(t.amount || 0) || 0, posted = t.posted || 0;
      if (amt >= 0 || !posted) return;
      var key = _clean(t.description || "") || "unknown";
      if (!by[key]) { by[key] = []; order.push(key); }
      by[key].push([posted, -amt]);
    });
    var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var out = [];
    order.forEach(function (key) {
      var rows = by[key]; rows.sort(function (a, b) { return a[0] - b[0]; });
      var posts = rows.map(function (r) { return r[0]; });
      var gaps = []; for (var i = 0; i < posts.length - 1; i++) gaps.push(posts[i + 1] - posts[i]);
      if (gaps.some(function (g) { return g < 200 * day; })) return;
      var lastP = rows[rows.length - 1][0], lastAmt = rows[rows.length - 1][1];
      var age = now - lastP;
      var yearly = gaps.filter(function (g) { return g >= 330 * day && g <= 430 * day; });
      var conf;
      if (gaps.length && yearly.length === gaps.length) conf = "yearly";
      else if (!gaps.length && age >= 270 * day && age <= 430 * day && lastAmt >= 15) conf = "maybe";
      else return;
      var step = yearly.length ? yearly.slice().sort(function (a, b) { return a - b; })[Math.floor(yearly.length / 2)] : 365 * day;
      var nxt = lastP + step;
      while (nxt < now) nxt += step;
      var days = pyRound((nxt - now) / day);
      if (days > 400) return;
      var d = new Date(nxt * 1000);
      out.push({ name: prettifyMerchant(key, _titleCase(key)), key: key, amount: round2(lastAmt),
        last: lastP, next: nxt, days: days, confidence: conf, when: MONTHS[d.getMonth()] + " " + d.getDate() });
    });
    out.sort(function (a, b) { return a.days !== b.days ? a.days - b.days : (a.key < b.key ? -1 : 1); });
    return out.slice(0, limit);
  }

  // subscription_items (mirror store.subscription_items) — the "subscriptions" category
  // grouped by merchant. NOTE this is the cheap grouping, NOT detect_recurring (deferred).
  function subscriptionItems(txns, overrides, remap) {
    var agg = Object.create(null), order = [];   // null-proto: a merchant that _cleans to "constructor" must not read Object.prototype.constructor (was a hard crash on it.descriptions)
    txns.forEach(function (t) {
      var amt = t.amount || 0;
      if (amt < 0 && categorize(t.description || "", overrides, remap) === "subscriptions") {
        var key = _clean(t.description || "") || "subscription";
        var it = agg[key];
        if (!it) { it = agg[key] = { name: _titleCase(key), key: key, amount: 0, count: 0, descriptions: [], accounts: [] }; order.push(key); }
        it.amount += -amt;
        it.count += 1;
        var desc = (t.description || "").trim();
        if (desc && it.descriptions.indexOf(desc) === -1 && it.descriptions.length < 6) it.descriptions.push(desc);
        var acct = (t.account || "").trim();
        if (acct && it.accounts.indexOf(acct) === -1) it.accounts.push(acct);
      }
    });
    var rows = order.map(function (k) { agg[k].amount = round2(agg[k].amount); return agg[k]; });
    rows.sort(function (a, b) { return b.amount - a.amount; });
    return rows;
  }
  function _titleCase(s) { return (s || "").replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }

  // ── SimpleFIN error handling (mirror store._sanitize_msg + store.extract_errors) ──
  // Third-party error text → one safe display line (control chars out, whitespace
  // collapsed, capped). These strings reach the UI, so never trust their shape.
  function _sanitizeMsg(s) {
    s = String(s == null ? "" : s).replace(/[\x00-\x1f\x7f]+/g, " ");
    return s.replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "").slice(0, 200);
  }
  // Human-readable, sanitized errors from a /accounts response — v2 `errlist`
  // (structured) and the deprecated v1 `errors` (strings), de-duped in order. The spec
  // REQUIRES these be displayed, so a partial or failed pull is never silently swallowed.
  function extractErrors(data) {
    var out = [];
    if (data && typeof data === "object") {
      (data.errlist || []).forEach(function (e) {
        var m = (e && typeof e === "object") ? _sanitizeMsg(e.msg || e.code || "") : _sanitizeMsg(e);
        if (m) out.push(m);
      });
      (data.errors || []).forEach(function (e) { var m = _sanitizeMsg(e); if (m) out.push(m); });   // v1 (DEPRECATED)
    }
    var seen = Object.create(null), uniq = [];
    out.forEach(function (m) { if (!seen[m]) { seen[m] = 1; uniq.push(m); } });
    return uniq;
  }
  // Institution name across protocol versions (mirror store._account_org_name):
  // v1 nested `org.name` → v2 Connection (`org_name`/`name` by `conn_id`) → `conn_name` → "".
  function accountOrgName(a, connById) {
    var org = a && a.org;
    if (org && typeof org === "object" && org.name) return org.name;
    var c = connById && connById[a && a.conn_id];
    if (c && typeof c === "object" && (c.org_name || c.name)) return c.org_name || c.name;
    return (a && a.conn_name) || "";
  }

  // ── build_snapshot (mirror store.build_snapshot) ─────────────────────────────
  // The bank-sync path. accounts: [{id,name,org,balance,currency,transactions:[...]}].
  // Returns {snapshot, txns}. Transfers ARE included in spending here (parity anchor).
  // opts.connections: the v2 Connection list — resolves institution names for v2 bridges.
  function buildSnapshot(accounts, opts) {
    opts = opts || {};
    // key by the Connection's own `conn_id` — MUST mirror store.build_snapshot
    // (`{c["conn_id"]: c}`), since the account references it by `conn_id`. Keying by `id`
    // instead silently blanks every v2 bank name on the web while the desktop shows them.
    var connById = Object.create(null);
    // mirror store.py `{c["conn_id"]: c for c in connections if isinstance(c, dict)}` EXACTLY —
    // including a null/absent conn_id, which Python keys under None (one slot). Guarding on
    // `conn_id != null` instead would drop those and diverge from the desktop.
    (opts.connections || []).forEach(function (c) { if (c && typeof c === "object") connById[c.conn_id] = c; });
    var windowDays = opts.windowDays || 30;
    var now = opts.now || Math.floor(Date.now() / 1000);
    var fetchDays = opts.fetchDays || windowDays;
    var overrides = opts.overrides || {}, incomeOverrides = opts.incomeOverrides || {}, remap = opts.remap || {};
    var fetchCutoff = now - fetchDays * 86400;
    var summaryCutoff = now - windowDays * 86400;
    var mid = now - Math.floor(windowDays / 2) * 86400;
    var total = 0, cash = 0, outflow = 0, recent = 0, older = 0, incomeTotal = 0, xferTotal = 0;
    var cats = Object.create(null), inc = Object.create(null), untaggedInc = Object.create(null);   // null-proto — user-derived keys (see categoriesFromTxns)
    var outAccounts = [], txns = [];

    (accounts || []).forEach(function (a) {
      var bal = parseFloat(a.balance || 0) || 0;
      total += bal;
      if (bal > 0) cash += bal;
      (a.transactions || []).forEach(function (t) {
        var posted, amt;
        try { posted = parseInt(t.posted, 10); amt = parseFloat(t.amount || 0) || 0; } catch (e) { return; }
        if (!isFinite(posted)) return;
        if (posted < fetchCutoff) return;
        var desc = t.description || t.payee || "";
        txns.push({ id: t.id, posted: posted, amount: round2(amt), description: desc, account: a.name || "Account" });
        if (posted < summaryCutoff) return;
        if (amt < 0) {
          var spend = -amt;
          var c = categorize(desc, overrides, remap);
          if (c === "transfer") { xferTotal += spend; return; }   // your own money moving / a card payment — never spending (mirrors store.build_snapshot)
          outflow += spend;
          cats[c] = (cats[c] || 0) + spend;
          if (posted >= mid) recent += spend; else older += spend;
        } else if (amt > 0) {
          var dec = incomeDecision(desc, incomeOverrides, overrides, remap);
          if (!dec[2]) untaggedInc[dec[0]] = 1;
          if (dec[1]) { incomeTotal += amt; inc[dec[0]] = (inc[dec[0]] || 0) + amt; }
        }
      });
      outAccounts.push({
        id: a.id, name: a.name || "Account",
        org: accountOrgName(a, connById),
        balance: round2(bal), currency: a.currency || "USD",
      });
    });

    var half = windowDays / 2.0;
    var rd = recent / half, od = older / half;
    var trend = od > 0 ? pyRound((rd - od) / od * 100) : null;
    var catsList = Object.keys(cats).map(function (k) { return { key: k, amount: round2(cats[k]) }; })
      .sort(function (a, b) { return b.amount - a.amount; });
    var incomeSources = Object.keys(inc).map(function (k) {
      return { source: prettifyMerchant(k, _titleCase(k)), key: k, amount: round2(inc[k]), tagged: Object.prototype.hasOwnProperty.call(incomeOverrides, k) };
    }).sort(function (a, b) { return b.amount - a.amount; });
    var windowTxns = txns.filter(function (t) { return t.posted >= summaryCutoff; });
    var subsItems = subscriptionItems(windowTxns, overrides, remap);
    var subsTotal = round2(subsItems.reduce(function (s, x) { return s + x.amount; }, 0));

    var snapshot = {
      updated: opts.updated || _isoNow(),
      total: round2(total),
      cash: round2(cash),
      burn_per_day: round2(outflow / windowDays),
      spend_window_days: windowDays,
      spending: {
        window_days: windowDays,
        total: round2(outflow),
        per_month: round2(outflow / windowDays * 30),
        per_day: round2(outflow / windowDays),
        trend_pct: trend,
        categories: catsList,
        transfers: round2(xferTotal),
      },
      income: {
        window_days: windowDays,
        total: round2(incomeTotal),
        per_month: round2(incomeTotal / windowDays * 30),
        sources: incomeSources,
        untagged: Object.keys(untaggedInc).length,
      },
      subscriptions: {
        window_days: windowDays,
        total: subsTotal,
        per_month: round2(subsTotal / windowDays * 30),
        items: subsItems,
      },
      accounts: outAccounts,
    };
    return { snapshot: snapshot, txns: txns };
  }
  function _isoNow() { try { return new Date().toISOString().replace(/\.\d+Z$/, "Z"); } catch (e) { return ""; } }

  // ── resolve_period / period_summary (mirror store) ───────────────────────────
  // The DASHBOARD read path: /api/summary?<period>. Computes income/spending/subs for an
  // arbitrary period from the full ledger. Transfers EXCLUDED (reported as a footnote).
  function _ymd(dateSecs) { var d = new Date(dateSecs * 1000); return { y: d.getFullYear(), m: d.getMonth() + 1, day: d.getDate() }; }
  function _localMidnight(y, m, day) { return Math.floor(new Date(y, m - 1, day || 1, 0, 0, 0, 0).getTime() / 1000); }
  var _MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function resolvePeriod(kind, ym, now, startD, endD, ledgerTxns) {
    now = now || Math.floor(Date.now() / 1000);
    if (kind === "custom" && startD && endD) {
      var a = startD.split("-").map(Number), b = endD.split("-").map(Number);
      if (a.length === 3 && b.length === 3 && a.every(isFinite) && b.every(isFinite)) {
        var start = _localMidnight(a[0], a[1], a[2]);
        var end = _localMidnight(b[0], b[1], b[2]) + 86400;
        if (end <= start) { var t = start; start = end - 86400; end = t + 86400; }
        var label = _MONTH_ABBR[a[1] - 1] + " " + a[2] + " – " + _MONTH_ABBR[b[1] - 1] + " " + b[2];
        return { start: start, end: end, label: label };
      }
    }
    if (kind === "30d") return { start: now - 30 * 86400, end: now, label: "Last 30 days" };
    if (kind === "90d") return { start: now - 90 * 86400, end: now, label: "Last 90 days" };
    if (kind === "all") {
      var ts = (ledgerTxns || []).map(function (t) { return t.posted || 0; }).filter(Boolean);
      return { start: ts.length ? Math.min.apply(null, ts) : now - 365 * 86400, end: now, label: "All time" };
    }
    var n = _ymd(now);
    if (!ym) ym = n.y + "-" + String(n.m).padStart(2, "0");
    var y = parseInt(ym.slice(0, 4), 10), mo = parseInt(ym.slice(5, 7), 10);
    var s = _localMidnight(y, mo, 1);
    var ny = mo === 12 ? y + 1 : y, nm = mo === 12 ? 1 : mo + 1;
    var e = Math.min(_localMidnight(ny, nm, 1), now);
    return { start: s, end: e, label: _MONTH_ABBR[mo - 1] + " " + y };
  }
  // ctx: {balances, overrides, incomeOverrides, remap, catmetaLabels}
  function periodSummary(ledgerTxns, params, ctx) {
    params = params || {};
    ctx = ctx || {};
    var overrides = ctx.overrides || {}, incomeOverrides = ctx.incomeOverrides || {}, remap = ctx.remap || {};
    var now = params.now || Math.floor(Date.now() / 1000);
    var p = resolvePeriod(params.kind || "mtd", params.ym, now, params.start, params.end, ledgerTxns);
    var win = (ledgerTxns || []).filter(function (t) { return p.start <= (t.posted || 0) && (t.posted || 0) < p.end; });
    var days = Math.max(1, pyRound((p.end - p.start) / 86400.0));   // banker's round to match store.py's round() (Math.round is half-up → off by a day on .5 boundaries)
    var outflow = 0, incomeTotal = 0, xferTotal = 0;
    var cats = Object.create(null), inc = Object.create(null), untaggedInc = Object.create(null);   // null-proto — user-derived keys
    win.forEach(function (t) {
      var amt = parseFloat(t.amount || 0); if (!isFinite(amt)) return;
      var desc = t.description || t.payee || "";
      if (amt < 0) {
        var spend = -amt;
        var c = categorize(desc, overrides, remap);
        if (c === "transfer") { xferTotal += spend; return; }
        outflow += spend;
        cats[c] = (cats[c] || 0) + spend;
      } else if (amt > 0) {
        var dec = incomeDecision(desc, incomeOverrides, overrides, remap);
        if (!dec[2]) untaggedInc[dec[0]] = 1;
        if (dec[1]) { incomeTotal += amt; inc[dec[0]] = (inc[dec[0]] || 0) + amt; }
      }
    });
    var catsList = Object.keys(cats).map(function (k) { return { key: k, amount: round2(cats[k]) }; })
      .sort(function (a, b) { return b.amount - a.amount; });
    var incomeSources = Object.keys(inc).map(function (k) {
      return { source: prettifyMerchant(k, _titleCase(k)), key: k, amount: round2(inc[k]), tagged: Object.prototype.hasOwnProperty.call(incomeOverrides, k) };
    }).sort(function (a, b) { return b.amount - a.amount; });
    var subsItems = subscriptionItems(win, overrides, remap);
    var subsTotal = round2(subsItems.reduce(function (s, x) { return s + x.amount; }, 0));
    var bal = ctx.balances || {};
    var norm = 30.0 / days;
    return {
      period: { kind: params.kind || "mtd", ym: params.ym || null, start: p.start, end: p.end, days: days, label: p.label, count: win.length },
      catmeta: { labels: ctx.catmetaLabels || {} },
      updated: bal.updated != null ? bal.updated : null,
      rev: bal.rev || 0,
      total: bal.total != null ? bal.total : null,
      cash: bal.cash != null ? bal.cash : null,
      accounts: bal.accounts || [],
      burn_per_day: round2(outflow / days),
      spend_window_days: days,
      spending: {
        window_days: days, total: round2(outflow),
        per_month: round2(outflow * norm), per_day: round2(outflow / days),
        trend_pct: null, categories: catsList,
        transfers: round2(xferTotal),
      },
      income: {
        window_days: days, total: round2(incomeTotal),
        per_month: round2(incomeTotal * norm),
        sources: incomeSources, untagged: Object.keys(untaggedInc).length,
      },
      subscriptions: {
        window_days: days, total: subsTotal,
        per_month: round2(subsTotal * norm), items: subsItems,
      },
    };
  }

  // ── rebuild_from_ledger (mirror store.rebuild_from_ledger + recompute_spending +
  //    recompute_income) ─────────────────────────────────────────────────────────
  // Takes a files map {name: jsonText}, rebuilds transactions.json (30d window) and the
  // balances.json spending/income/subscriptions blocks + bumps rev, all from the full
  // ledger. Account balances (total/cash/accounts/updated) are LEFT AS-IS, exactly like a
  // desktop CSV import (a CSV carries no live balance). Returns a NEW files map.
  // Coverage + monthly rollups are DEFERRED (left untouched) — the desktop recomputes them
  // canonically on its next sync.
  function _overridesFrom(files) {
    return {
      overrides: _parseObj(files["categories.json"]),
      incomeOverrides: _parseObj(files["income.json"]),
      remap: (_parseObj(files["catmeta.json"]).remap) || {},
      catmetaLabels: (_parseObj(files["catmeta.json"]).labels) || {},
      tomb: _parseObj(files["deleted.json"]),
    };
  }
  function _parseObj(text) { try { var v = JSON.parse(text || "{}"); return (v && typeof v === "object" && !Array.isArray(v)) ? v : {}; } catch (e) { return {}; } }
  function _nextRev(bal) { try { return (parseInt((bal || {}).rev, 10) || 0) + 1; } catch (e) { return 1; } }

  function rebuildFromLedger(files, opts) {
    opts = opts || {};
    var windowDays = opts.windowDays || 30;
    var now = opts.now || Math.floor(Date.now() / 1000);
    var ctx = _overridesFrom(files);
    var led = parseJsonl(files["ledger.jsonl"]);
    var txns = Object.keys(led).map(function (k) { return led[k]; });
    var cutoff = now - windowDays * 86400;
    var window = txns.filter(function (t) { return (t.posted || 0) >= cutoff; });
    window.sort(function (a, b) { return (b.posted || 0) - (a.posted || 0); });

    var out = {}; Object.keys(files).forEach(function (n) { out[n] = files[n]; });
    // transactions.json (mirror save_transactions)
    out["transactions.json"] = JSON.stringify({ updated: _isoNow(), window_days: windowDays, transactions: window }, null, 2);

    // balances.json — recompute_spending + recompute_income (both read the WINDOW, not the
    // full ledger, and neither touches total/cash/accounts/updated). rev bumps once per
    // recompute in store.py; we mirror that (two bumps: spending then income).
    var bal = _parseObj(files["balances.json"]);
    // recompute_spending — totals INCLUDED (mirrors store.py's honest-burn fix: a categorize
    // edit must move total/per_day/burn/trend too, not just the category list, or tagging a
    // transfer leaves the burn inflated until the next sync)
    var sp = (bal.spending && typeof bal.spending === "object") ? bal.spending : {};
    sp.categories = categoriesFromTxns(window, ctx.overrides, ctx.remap);
    var wd = sp.window_days || bal.spend_window_days || 30;
    var nowTs = Math.floor(Date.now() / 1000), midTs = nowTs - Math.floor(wd / 2) * 86400;
    var outflow = 0, xferTotal = 0, recent = 0, older = 0;
    window.forEach(function (t) {
      var amt = parseFloat(t.amount || 0); if (!isFinite(amt) || amt >= 0) return;
      var spend = -amt;
      if (categorize(t.description || "", ctx.overrides, ctx.remap) === "transfer") { xferTotal += spend; return; }
      outflow += spend;
      if ((t.posted || 0) >= midTs) recent += spend; else older += spend;
    });
    var half2 = wd / 2.0, rd2 = recent / half2, od2 = older / half2;
    sp.total = round2(outflow);
    sp.per_month = round2(outflow / wd * 30);
    sp.per_day = round2(outflow / wd);
    sp.trend_pct = od2 > 0 ? pyRound((rd2 - od2) / od2 * 100) : null;
    sp.transfers = round2(xferTotal);
    bal.burn_per_day = round2(outflow / wd);
    bal.spending = sp;
    var subsItems = subscriptionItems(window, ctx.overrides, ctx.remap);
    var subsTotal = round2(subsItems.reduce(function (s, x) { return s + x.amount; }, 0));
    bal.subscriptions = { window_days: wd, total: subsTotal, per_month: round2(subsTotal / wd * 30), items: subsItems };
    bal.rev = _nextRev(bal);
    // recompute_income
    var incWd = (bal.income && bal.income.window_days) || bal.spend_window_days || 30;
    var total = 0, inc = Object.create(null), untagged = Object.create(null);   // null-proto — user-derived income keys
    window.forEach(function (t) {
      var amt = t.amount || 0;
      if (amt > 0) {
        var dec = incomeDecision(t.description || "", ctx.incomeOverrides, ctx.overrides, ctx.remap);
        if (!dec[2]) untagged[dec[0]] = 1;
        if (dec[1]) { total += amt; inc[dec[0]] = (inc[dec[0]] || 0) + amt; }
      }
    });
    var sources = Object.keys(inc).map(function (k) {
      return { source: prettifyMerchant(k, _titleCase(k)), key: k, amount: round2(inc[k]), tagged: Object.prototype.hasOwnProperty.call(ctx.incomeOverrides, k) };
    }).sort(function (a, b) { return b.amount - a.amount; });
    bal.income = { window_days: incWd, total: round2(total), per_month: round2(total / incWd * 30), sources: sources, untagged: Object.keys(untagged).length };
    bal.rev = _nextRev(bal);
    out["balances.json"] = JSON.stringify(bal, null, 2);
    return out;
  }

  // ── CSV importer (mirror import_statements.py) ───────────────────────────────
  var DATE_KEYS = ["date", "posting date", "posted date", "transaction date", "trans date"];
  var AMT_KEYS = ["amount", "amt"];
  var DEBIT_KEYS = ["debit", "withdrawal", "withdrawals", "money out", "outflow"];
  var CREDIT_KEYS = ["credit", "deposit", "deposits", "money in", "inflow"];
  var DESC_KEYS = ["description", "payee", "name", "memo", "details", "merchant", "transaction"];
  var ACCT_KEYS = ["account", "account name"];
  var ACCT_NUM_KEYS = ["card no", "card number", "account number", "account no", "acct no", "acct number", "card"];

  // a small RFC-4180-ish parser: handles quoted fields, embedded commas/newlines, "" escapes
  function parseCsvRows(text) {
    var rows = [], row = [], field = "", i = 0, inQ = false, c;
    text = (text || "").replace(/^﻿/, "");   // strip BOM (utf-8-sig)
    while (i < text.length) {
      c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
  function _find(headers, keys) {
    var low = {};
    headers.forEach(function (h) { if (h) low[h.toLowerCase().trim()] = h; });
    for (var i = 0; i < keys.length; i++) if (low[keys[i]]) return low[keys[i]];
    for (var j = 0; j < headers.length; j++) {
      var h = headers[j];
      if (h && keys.some(function (k) { return h.toLowerCase().indexOf(k) !== -1; })) return h;
    }
    return null;
  }
  function _num(x) {
    x = (x || "").trim().replace(/\$/g, "").replace(/,/g, "");
    var neg = x.charAt(0) === "(" && x.charAt(x.length - 1) === ")";
    x = x.replace(/^\(+|\)+$/g, "");
    if (!x) return null;
    // Accept exactly what Python float() accepts for realistic amounts: optional sign,
    // digits with an optional decimal point (leading OR trailing dot ok), optional exponent.
    // The old /\d*\.?\d+/ rejected "5." and "1e3" — which store.py's bare float() KEEPS — so
    // those rows were present on desktop but silently missing from a web import (ledger fork).
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(x)) return null;
    var v = parseFloat(x);
    if (!isFinite(v)) return null;   // reject inf/nan (store.py gets the matching guard) — a non-finite amount would corrupt every sum
    return neg ? -v : v;
  }
  function _parseAmount(row, amtCol, debitCol, creditCol) {
    if (amtCol) return _num(row[amtCol]);
    var d = debitCol ? _num(row[debitCol]) : null;
    var c = creditCol ? _num(row[creditCol]) : null;
    if (d) return -Math.abs(d);
    if (c) return Math.abs(c);
    return null;
  }
  // date parse — try store's DATE_FORMATS in order, validating ranges, using LOCAL time
  // (Python's naive datetime.strptime(...).timestamp() is local; both sides share the tz)
  // Try store's DATE_FORMATS in order; a format that matches the shape but yields an
  // out-of-range date (e.g. month 15) must FALL THROUGH to the next, exactly like Python's
  // strptime raising ValueError — this is what lets "15/01/2026" reach %d/%m/%Y.
  function parseDate(s) {
    s = (s || "").trim();
    if (!s) return null;
    var m, r;
    // %m/%d/%Y  ·  %m/%d/%Y %H:%M
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/))) { r = _mk(+m[3], +m[1], +m[2], +m[4] || 0, +m[5] || 0); if (r != null) return r; }
    // %m/%d/%y — C89 pivot, matching Python strptime %y: 69-99 → 19xx, 00-68 → 20xx
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/))) { var yy = +m[3]; r = _mk(yy >= 69 ? 1900 + yy : 2000 + yy, +m[1], +m[2]); if (r != null) return r; }
    // %Y-%m-%d  ·  %Y-%m-%d %H:%M:%S
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?$/))) { r = _mk(+m[1], +m[2], +m[3], +m[4] || 0, +m[5] || 0, +m[6] || 0); if (r != null) return r; }
    // %m-%d-%Y
    if ((m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/))) { r = _mk(+m[3], +m[1], +m[2]); if (r != null) return r; }
    // %Y/%m/%d
    if ((m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/))) { r = _mk(+m[1], +m[2], +m[3]); if (r != null) return r; }
    // %d/%m/%Y (reached only when %m/%d/%Y failed — i.e. month>12)
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) { r = _mk(+m[3], +m[2], +m[1]); if (r != null) return r; }
    // %b %d, %Y  → "Jan 5, 2026"
    if ((m = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/))) {
      var mo = _MONTH_ABBR.map(function (x) { return x.toLowerCase(); }).indexOf(m[1].toLowerCase());
      if (mo >= 0) { r = _mk(+m[3], mo + 1, +m[2]); if (r != null) return r; }
    }
    return null;
  }
  function _mk(y, mo, d, H, M, S) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var dt = new Date(y, mo - 1, d, H || 0, M || 0, S || 0, 0);
    if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;   // reject overflow (Feb 30 etc), like strptime
    return Math.floor(dt.getTime() / 1000);
  }
  function _last4(s) { var d = (s || "").replace(/\D/g, ""); return d.length >= 4 ? d.slice(-4) : null; }
  function _acctFromName(filename) {
    var name = (filename || "").replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "");
    // .toLowerCase() first so this matches Python str.title() (upper first letter, LOWER the
    // rest of each word) — without it "myCard.csv" → "MyCard" on web but "Mycard" on desktop,
    // stamping a different account label into the shared vault for the same file.
    return name.replace(/[_\-0-9]+/g, " ").trim().toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); }) || "Imported";
  }
  // deterministic id (mirror import_statements._gen_id shape "csv:<hash>"). NOT SHA-1: a
  // hand-rolled sync SHA-1 is a needless parity risk, and cross-device double-counting is
  // already prevented by the content-key dedupe below (a web-csv row and the same
  // desktop-csv row collapse on day|amount|desc, whatever their ids). So a stable djb2 id
  // is enough and clearly namespaced. Interop note lives in the pending-merge memory.
  function _genId(t) {
    var raw = t.account + "|" + t.posted + "|" + t.amount + "|" + t.description;
    var h = 5381; for (var i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) | 0;
    return "csv:" + (h >>> 0).toString(16);
  }
  function _liveAccountMap(led) {
    var out = {};
    Object.keys(led || {}).forEach(function (k) {
      var n = led[k].account; if (!n) return;
      var d = n.replace(/\D/g, "");
      if (d.length >= 4 && !out[d.slice(-4)]) out[d.slice(-4)] = n;
    });
    return out;
  }
  // parse CSV text → {txns, error}. led (existing ledger) drives last-4 account matching.
  function parseCsv(text, filename, led) {
    var rows = parseCsvRows(text);
    if (!rows.length) return { txns: [], error: "empty file" };
    var headers = rows[0];
    var dateCol = _find(headers, DATE_KEYS);
    var amtCol = _find(headers, AMT_KEYS);
    var debitCol = _find(headers, DEBIT_KEYS);
    var creditCol = _find(headers, CREDIT_KEYS);
    var descCol = _find(headers, DESC_KEYS);
    var acctCol = _find(headers, ACCT_KEYS);
    var acctnumCol = _find(headers, ACCT_NUM_KEYS);
    if (!dateCol || !(amtCol || debitCol || creditCol)) {
      var seen = headers.filter(Boolean).join(", ") || "(no header row)";
      return { txns: [], error: "couldn't find date/amount columns — saw: " + seen };
    }
    var live = _liveAccountMap(led);
    var acctGuess = _acctFromName(filename);
    var fnameAcct = null, grps = (filename || "").match(/\d{4}/g) || [];
    for (var g = 0; g < grps.length; g++) { if (live[grps[g]]) { fnameAcct = live[grps[g]]; break; } }
    var idx = {}; headers.forEach(function (h, i) { idx[h] = i; });
    var txns = [];
    for (var r = 1; r < rows.length; r++) {
      var cells = rows[r];
      if (cells.length === 1 && cells[0] === "") continue;   // blank line
      var row = {}; headers.forEach(function (h, i) { row[h] = cells[i] != null ? cells[i] : ""; });
      var posted = parseDate(row[dateCol]);
      var amt = _parseAmount(row, amtCol, debitCol, creditCol);
      if (posted == null || amt == null) continue;
      var desc = descCol ? (row[descCol] || "").trim() : "";
      var acct = acctCol ? (row[acctCol] || "").trim() : "";
      if (!acct && acctnumCol) { var l4 = _last4(row[acctnumCol] || ""); if (l4 && live[l4]) acct = live[l4]; }
      if (!acct) acct = fnameAcct || acctGuess;
      var t = { id: null, posted: posted, amount: round2(amt), description: desc, account: acct };
      t.id = _genId(t);
      txns.push(t);
    }
    return { txns: txns, error: null };
  }

  // content-key dedupe (mirror import_statements._content_key + import_records) — a
  // MULTISET so a genuine second identical purchase the same day still comes through.
  function _contentKey(t) {
    var day = Math.floor((t.posted || 0) / 86400);
    var desc = (t.description || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 18);
    return day + "|" + round2(t.amount || 0) + "|" + desc;
  }
  // Import parsed txns into a files map: dedupe against the existing ledger, merge the new
  // ones, rebuild the window + snapshot. Returns {files, added, dup}. Mirrors
  // import_statements.import_records + store.rebuild_from_ledger.
  function importTxns(files, txns, opts) {
    opts = opts || {};
    // mintSuffix: freshly-parsed CSV rows carry un-suffixed ids, so the n-th same-content
    // occurrence needs a "-n" suffix to stay a distinct ledger key (matches store.py). But
    // applyToVault re-folds _pending, whose ids are ALREADY final/occurrence-suffixed — running
    // them through the suffixer again would mint "csv:h-2-2". So that path passes mintSuffix:false.
    var mintSuffix = opts.mintSuffix !== false;
    var ctx = _overridesFrom(files);
    var led = parseJsonl(files["ledger.jsonl"]);
    var have = Object.create(null), used = Object.create(null);   // keys are "day|amt|desc" (never a bare proto name), but null-proto for uniformity
    Object.keys(led).forEach(function (k) { var ck = _contentKey(led[k]); have[ck] = (have[ck] || 0) + 1; });
    var newTxns = [], dup = 0;
    txns.forEach(function (t) {
      var ck = _contentKey(t);
      used[ck] = (used[ck] || 0) + 1;
      if (used[ck] <= (have[ck] || 0)) { dup++; return; }
      t = Object.assign({}, t);
      if (mintSuffix && used[ck] > 1) t.id = t.id + "-" + used[ck];   // unique id per occurrence (fresh CSV rows only)
      newTxns.push(t);
    });
    // a txn the user deleted (tombstoned) is dropped by mergeLedger and must not be counted
    // as "added" — count only what actually lands
    var landed = newTxns.filter(function (t) { return !isDeleted(ledgerKey(t), ctx.tomb); });
    if (!landed.length) return { files: files, added: 0, dup: dup };
    var mergedLed = mergeLedger(led, newTxns, ctx.tomb);
    var out = {}; Object.keys(files).forEach(function (n) { out[n] = files[n]; });
    out["ledger.jsonl"] = serializeJsonl(mergedLed);
    out = rebuildFromLedger(out, opts);
    return { files: out, added: landed.length, dup: dup };
  }

  // ── SimpleFIN: claim a token + pull accounts, IN THE BROWSER ─────────────────
  // Ports sync.py (claim_setup_token / fetch_accounts / run_sync). The credential (the
  // Access URL) is a bearer secret to the user's bank; it is handled ONLY here and stored
  // device-local by app.js — it never rides the vault, never lands in a URL/log/toast.
  var SF_HOST = "beta-bridge.simplefin.org";
  var SF_LEGACY = "bridge.simplefin.org";
  var SF_FETCH_DAYS = 90, SF_WINDOW_DAYS = 30;
  // base64 works in the browser (atob/btoa) and in node (globals ≥16, Buffer otherwise) so
  // the decode/auth functions are unit-testable without a DOM
  var _atob = (typeof atob !== "undefined") ? atob : function (s) { return require("buffer").Buffer.from(s, "base64").toString("binary"); };
  var _btoa = (typeof btoa !== "undefined") ? btoa : function (s) { return require("buffer").Buffer.from(s, "binary").toString("base64"); };
  // https + the simplefin bridge allowlist (mirrors server.py ALLOWED_BRIDGE_HOSTS). The
  // legacy host 302s dropping the path with no CORS headers, so REWRITE it to beta rather
  // than allowlist it. Mutates + returns the URL; throws a plain-language error otherwise.
  function _sfAllowHost(u) {
    if (u.protocol !== "https:") throw new Error("That bank link isn't secure (https) — re-copy your setup token.");
    if (u.hostname === SF_LEGACY) u.hostname = SF_HOST;
    if (u.hostname !== SF_HOST) throw new Error("That link points somewhere we don't recognize — only SimpleFIN connections work in the browser.");
    return u;
  }
  // Setup token (base64) → claim URL. Strip whitespace, re-pad `=`, decode, validate.
  function sfDecodeToken(setupToken) {
    var token = String(setupToken == null ? "" : setupToken).replace(/\s+/g, "");
    if (!token) throw new Error("Paste your SimpleFIN setup token first.");
    while (token.length % 4) token += "=";
    var claim;
    try { claim = _atob(token).replace(/^\s+|\s+$/g, ""); }
    catch (e) { throw new Error("That doesn't look like a valid setup token — copy the whole token from SimpleFIN's “New app connection” and try again."); }
    if (claim.indexOf("http") !== 0) throw new Error("That token didn't decode to a valid link — copy the full token and retry.");
    var u; try { u = new URL(claim); } catch (e2) { throw new Error("That token didn't decode to a valid link — copy the full token and retry."); }
    return _sfAllowHost(u).href;
  }
  // Access URL (https://user:pass@host/path) → the /accounts request. fetch() throws on
  // credentials-in-URL, so we STRIP the userinfo and send Basic auth in a header instead —
  // the credential can never land in a URL, log, or referrer. userinfo stays percent-encoded
  // (never decodeURIComponent): new URL().username matches Python's urlparse, preserving parity.
  function sfAccountsRequest(accessUrl, startDate) {
    var u; try { u = new URL(accessUrl); } catch (e) { throw new Error("Your saved bank connection looks corrupted — reconnect to fix it."); }
    var user = u.username, pass = u.password;
    _sfAllowHost(u);   // https + host allowlist (rewrites legacy) — after reading userinfo
    var url = u.protocol + "//" + u.host + u.pathname.replace(/\/+$/, "") + "/accounts";
    if (startDate) url += "?start-date=" + String(Math.floor(startDate));
    return { url: url, auth: "Basic " + _btoa(user + ":" + pass) };
  }
  // A /accounts response (already fetched) + the current money files → new money files.
  // Pure (no network), so it's unit-testable. Mirrors run_sync: errors → zero-wipe guard →
  // build_snapshot → merge_ledger (by bank id, NOT the CSV content-occurrence counter) →
  // recompute, then overlay the REAL balances (total/cash/accounts) the ledger can't carry.
  function sfApply(files, data, opts) {
    opts = opts || {};
    var now = opts.now || Math.floor(Date.now() / 1000);
    var accounts = (data && data.accounts) || [];
    var errors = extractErrors(data);
    // NO accounts → refuse to write, WITH or without errors. A 200 can carry errors and no
    // accounts (a bank login expired), but it can also be empty and error-free — either way,
    // writing it zeroes balances + blanks the window, and on web the vault is the ONLY durable
    // copy, so a push would destroy the good data everywhere. Surface the bank's message if any.
    if (!accounts.length) {
      var err = new Error(errors.length
        ? "Bank sync couldn't get your data: " + errors.join("; ")
        : "Bank sync returned no accounts — nothing was changed. Try again in a moment.");
      err.sfErrors = errors;
      throw err;
    }
    var built = buildSnapshot(accounts, {
      windowDays: SF_WINDOW_DAYS, fetchDays: SF_FETCH_DAYS, now: now,
      connections: data && data.connections, updated: opts.updated || _isoNow(),
    });
    var ctx = _overridesFrom(files);
    var led = parseJsonl(files["ledger.jsonl"]);
    var before = Object.keys(led).length;
    var merged = mergeLedger(led, built.txns, ctx.tomb);   // id-keyed, tombstone-aware, shrink-guarded
    var out = {}; Object.keys(files).forEach(function (n) { out[n] = files[n]; });
    out["ledger.jsonl"] = serializeJsonl(merged);
    out = rebuildFromLedger(out, { now: now });   // spending/income/subs/transactions.json from the ledger window
    // overlay what rebuildFromLedger deliberately doesn't touch — the real bank balances
    var bal = _parseObj(out["balances.json"]), snap = built.snapshot;
    bal.total = snap.total; bal.cash = snap.cash; bal.accounts = snap.accounts;
    bal.burn_per_day = snap.burn_per_day; bal.spend_window_days = snap.spend_window_days;
    bal.updated = snap.updated;   // the ONE browser event that moves `updated` — a real bank pull
    out["balances.json"] = JSON.stringify(bal, null, 2);
    // which ledger entries are genuinely new (for the cloud-push re-merge + the UI count)
    var addedTxns = built.txns.filter(function (t) { return !led[ledgerKey(t)] && !isDeleted(ledgerKey(t), ctx.tomb); });
    return { files: out, added: Object.keys(merged).length - before, addedTxns: addedTxns, errors: errors, snapshot: snap };
  }
  // Claim a setup token in the browser → the durable Access URL. The POST MUST stay a CORS
  // "simple request": NO headers object, NO body, NO Content-Type, NO mode override. The claim
  // endpoint has no OPTIONS handler, so ANY custom header triggers a preflight that 404s and
  // kills the flow. Do not "improve" this call. (sync.py claim_setup_token.)
  function sfClaim(setupToken) {
    var claimUrl = sfDecodeToken(setupToken);   // throws on a bad token
    return fetch(claimUrl, { method: "POST" }).then(function (r) {
      if (!r.ok) {
        if (r.status === 403) throw new Error("SimpleFIN rejected that token (403). A setup token can only be claimed once — if you didn't just reuse it, treat it as compromised: delete it in SimpleFIN and make a new connection.");
        throw new Error("Couldn't set up the connection (HTTP " + r.status + ").");
      }
      return r.text();
    }).then(function (txt) {
      var accessUrl = String(txt).replace(/^\s+|\s+$/g, "");
      var u; try { u = new URL(accessUrl); } catch (e) { throw new Error("SimpleFIN returned something unexpected — make a new connection and try again."); }
      _sfAllowHost(u);   // must be https on the allowed host
      return accessUrl;
    });
  }
  // Pull /accounts with Basic auth (credentials in the header, never the URL). /accounts
  // DOES preflight fine — Authorization is an allowed header. (sync.py fetch_accounts.)
  function sfFetchAccounts(accessUrl, startDate) {
    var req = sfAccountsRequest(accessUrl, startDate);   // {url, auth} — userinfo stripped
    return fetch(req.url, { headers: { "Authorization": req.auth } }).then(function (r) {
      if (!r.ok) {
        if (r.status === 403) throw new Error("Your bank connection was declined (403) — access may have been revoked, or the saved credential is no longer valid. Reconnect to fix it.");
        if (r.status === 402) throw new Error("Your SimpleFIN bridge says payment is required (402) before it will share data. Check your SimpleFIN account, then sync again.");
        throw new Error("Bank sync failed (HTTP " + r.status + ").");
      }
      return r.json();
    });
  }

  // ── public surface ───────────────────────────────────────────────────────────
  var CacheMoney = {
    pyRound: pyRound, round2: round2,
    categorize: categorize, prettifyMerchant: prettifyMerchant, isIncome: isIncome,
    incomeDecision: incomeDecision, subscriptionItems: subscriptionItems,
    categoriesFromTxns: categoriesFromTxns,
    topMerchants: topMerchants, otherMerchants: otherMerchants, depositSources: depositSources,
    annualPredictions: annualPredictions, nextDeposit: nextDeposit,
    ledgerKey: ledgerKey, isDeleted: isDeleted, mergeLedger: mergeLedger,
    parseJsonl: parseJsonl, serializeJsonl: serializeJsonl,
    buildSnapshot: buildSnapshot,
    resolvePeriod: resolvePeriod, periodSummary: periodSummary,
    rebuildFromLedger: rebuildFromLedger,
    parseCsv: parseCsv, importTxns: importTxns,
    extractErrors: extractErrors, accountOrgName: accountOrgName,
    sfDecodeToken: sfDecodeToken, sfAccountsRequest: sfAccountsRequest, sfApply: sfApply,
    _clean: _clean, _incomeKey: _incomeKey, _contentKey: _contentKey, _genId: _genId,
  };

  if (typeof window !== "undefined") window.CacheMoney = CacheMoney;
  if (typeof module !== "undefined" && module.exports) module.exports = CacheMoney;   // node tests require() this directly (no anchor slicing to rot)

  // ── web wiring: the import flow (only on the hosted web app) ──────────────────
  // Reads the current money files from webcache's decrypted store, runs the import +
  // compute here in the browser, writes the result back, and arms a cloud push so the
  // sealed vault syncs to the user's other devices. Everything happens client-side; the
  // server only ever sees ciphertext. This is the ONE place the web app writes money.
  if (typeof window !== "undefined" && window.__CACHE_WEB__) {
    // remember every txn imported this session (the deltas) so the push can safely re-merge
    // them into the FRESHEST vault ledger — never clobbering a concurrent desktop bank sync.
    var _pending = [];
    window.__cacheMoneyPending = function () { return _pending.slice(); };
    window.__cacheMoneyImport = function (filename, text) {
      var bridge = window.__cacheWebMoney;
      if (!bridge) return { ok: false, error: "cloud not ready yet — try again in a moment" };
      var files = bridge.getFiles() || {};
      var parsed = parseCsv(text, filename, parseJsonl(files["ledger.jsonl"]));
      if (parsed.error) return { ok: false, error: parsed.error };
      if (!parsed.txns.length) return { ok: false, error: "no transactions found in that CSV" };
      var res = importTxns(files, parsed.txns, {});
      if (!res.added) return { ok: true, added: 0, dup: res.dup };
      // record the raw deltas (the ledger keys new since before this import, not already
      // pending) for the push-time re-merge into the freshest vault ledger
      var led = parseJsonl(res.files["ledger.jsonl"]);
      var preLed = parseJsonl(files["ledger.jsonl"]);
      var known = {}; _pending.forEach(function (t) { known[ledgerKey(t)] = 1; });
      Object.keys(led).forEach(function (k) { if (!preLed[k] && !known[k]) _pending.push(led[k]); });
      // commit the new money files; the dashboard's /api/summary is computed LIVE from the
      // ledger by webcache (MONEY_LIVE), so the imported data shows immediately — no stale,
      // now-dependent precomputed summary to seal or churn.
      bridge.commit(res.files);
      return { ok: true, added: res.added, dup: res.dup };
    };
    // called by cloudPush's web branch: merge this session's imported txns into the vault's
    // OWN (freshest) files, so a concurrent desktop bank sync is never lost. Returns the
    // merged {files} or null when there's nothing to apply.
    window.__cacheMoneyApplyToVault = function (vaultFiles) {
      if (!_pending.length) return null;
      // mintSuffix:false — _pending ids are already final (occurrence-suffixed at import);
      // re-suffixing here would fork the ledger id from what store.py produces for the same CSV.
      var res = importTxns(vaultFiles || {}, _pending, { mintSuffix: false });
      // hand back a SNAPSHOT of exactly what this push is sealing; the caller confirms it only
      // after the upload lands, so a failed push leaves _pending intact and retryable.
      return { files: res.files, folded: _pending.slice() };
    };
    // Called by cloudPush ONLY after the vault upload succeeds (or is confirmed already-sealed):
    // drop the sealed deltas from _pending so the import's "still saving…" retry knows it's done.
    // Removes exactly the folded keys — imports that arrived mid-push stay pending and seal next.
    window.__cacheMoneyConfirmSealed = function (folded) {
      if (!folded || !folded.length) return;
      var done = Object.create(null);
      folded.forEach(function (t) { done[ledgerKey(t)] = 1; });
      _pending = _pending.filter(function (t) { return !done[ledgerKey(t)]; });
    };
    // SimpleFIN, in the browser. claim() returns the Access URL (app.js stores it device-local,
    // never in the vault); pull() fetches + computes + commits, exactly like a CSV import but
    // from a live bank. Both resolve to {ok:...} and never reject, so the UI shows a message.
    window.__cacheMoneySfClaim = function (setupToken) {
      return sfClaim(setupToken).then(function (accessUrl) { return { ok: true, accessUrl: accessUrl }; })
        .catch(function (e) { return { ok: false, error: (e && e.message) || "couldn't connect" }; });
    };
    window.__cacheMoneySfPull = function (accessUrl) {
      var bridge = window.__cacheWebMoney;
      if (!bridge) return Promise.resolve({ ok: false, error: "cloud not ready yet — try again in a moment" });
      var now = Math.floor(Date.now() / 1000);
      return sfFetchAccounts(accessUrl, now - (SF_FETCH_DAYS + 2) * 86400).then(function (data) {
        var files = bridge.getFiles() || {};
        var res = sfApply(files, data, { now: now });   // throws on the zero-wipe guard (errors + no accounts)
        res.addedTxns.forEach(function (t) { _pending.push(t); });   // seal these into the vault on the next push
        bridge.commit(res.files);
        return { ok: true, added: res.added, errors: res.errors };
      }).catch(function (e) {
        return { ok: false, error: (e && e.message) || "sync failed", errors: (e && e.sfErrors) || [] };
      });
    };
  }
})();
