// HTML ESCAPING — the XSS choke point, and the app.js ↔ webcache.js parity that keeps it honest.
//
// Every string another person or a bank feed can author (DM bodies, @handles, synced names, deck
// cards, transaction descriptions) goes through escapeHtml/esc before the DOM. If that function
// misses a metacharacter, an attacker's value breaks out of the markup and runs next to the
// decrypted vault (security-principles §2). This locks the FIVE characters that matter — including
// the single quote, added 2026-07-17 because some attributes are single-quoted (data-ids='…') and
// a ' would otherwise break out — and proves the two runtimes escape byte-identically (a drift
// would mean one surface is safe and the other isn't).
const fs = require("fs"), path = require("path");
function slice(file, aRe, bRe) {
  const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8").split("\n");
  const at = (re) => { const i = src.findIndex((l) => re.test(l)); if (i < 0) throw new Error("anchor " + re + " in " + file); return i; };
  return src.slice(at(aRe), at(bRe) + 1).join("\n");
}
// app.js: const escapeHtml = (s) => … (two lines)
const appEsc = Function(slice("app.js", /^const escapeHtml =/, /String\(s\)\.replace/) + "\nreturn escapeHtml;")();
// webcache.js: function esc(s) { … } (one line, inside the IIFE)
const webEsc = Function(slice("webcache.js", /^  function esc\(s\)/, /^  function esc\(s\)/) + "\nreturn esc;")();

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error("  ✗ " + msg); } }
function eq(a, b, msg) { ok(a === b, msg + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }

// the five metacharacters each map to their entity
eq(appEsc("&"), "&amp;", "app: & → &amp;");
eq(appEsc("<"), "&lt;", "app: < → &lt;");
eq(appEsc(">"), "&gt;", "app: > → &gt;");
eq(appEsc('"'), "&quot;", "app: \" → &quot;");
eq(appEsc("'"), "&#39;", "app: ' → &#39; (the single-quote fix)");

// the single-quoted-attribute breakout is closed: no bare ' survives to end the attribute
const evil = "x' onmouseover='alert(1)";
ok(appEsc(evil).indexOf("'") === -1, "app: a value in a single-quoted attribute can't break out");
ok(appEsc("</script><script>").indexOf("<") === -1, "app: angle brackets can't open a tag");

// parity: the two runtimes must agree byte-for-byte, or one surface is unsafe
const samples = ["&", "<", ">", '"', "'", "a'b\"c<d>e&f", "🙂 <b>hi</b> it's", "\"''\"", "' or '1'='1"];
for (const s of samples) eq(appEsc(s), webEsc(s), "parity for " + JSON.stringify(s));

// idempotent-ish: escaping is safe on already-escaped-ish text (no double-unescape surprise here,
// just confirm it doesn't throw and leaves letters alone)
eq(appEsc("plain text 123"), "plain text 123", "plain text passes through unchanged");

console.log(pass + " passed, " + fail + " failed");   // leading number so run.sh tallies it
process.exit(fail ? 1 : 0);
