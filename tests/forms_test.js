// money.forms (templates) + money.formData (submissions) — the form-builder store.
// Both REUSE money.things' per-item merge verbatim (mergeThings/thingCanon), so the merge
// itself is already pinned by things_test + the parity fixtures below; this harness focuses
// on what's NEW: id minting, the live filters, and the document→template PARSERS (the CSV
// splitter + type inference + Q&A/label heuristics). Loads the REAL functions by ANCHOR so
// it can't rot on line drift. Fixtures are placeholders only — never real data.
const fs = require("fs"), path = require("path");
const grab = (file, aRe, bRe) => {
  const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8").split("\n");
  const at = (re) => { const i = src.findIndex((l) => re.test(l)); if (i < 0) throw new Error("anchor " + re + " in " + file); return i; };
  return src.slice(at(aRe), at(bRe)).join("\n");
};
// stub the browser globals the app.js block touches
function makeLS(){const s={};return{_s:s,getItem:k=>k in s?s[k]:null,setItem:(k,v)=>{s[k]=String(v)},removeItem:k=>{delete s[k]},key:i=>Object.keys(s)[i]??null,get length(){return Object.keys(s).length}};}
let localStorage = makeLS();
const document = { dispatchEvent(){}, addEventListener(){} };
function devId(){ return "devA"; }
function autoPushSoon(){}
// app.js money.things region — INCLUDES the FORMS block (mergeThings, formId, csvToTemplate…)
eval(grab("app.js", /^const THINGS_KEY = "money\.things"/, /^function loadLog/));
// webcache.js parity: pull wThingCanon + wMergeThings (forms reuse it — no separate merge fn)
eval(grab("webcache.js", /function wThingCanon/, /function wIsGeneric/));

let p=0,f=0; const ok=(n,c)=>{c?p++:f++;console.log((c?"  ok  ":"FAIL  ")+n)};

// ── 1. id minting: stable format, distinct prefixes, unique ──
{
  const a = formId(), b = formSubId(), c = fieldId();
  ok("formId format f<time>-<dev4>-<rand6>", /^f[a-z0-9]+-.{4}-.{6}$/.test(a));
  ok("formSubId is prefixed fd", /^fd[a-z0-9]+-.{4}-.{6}$/.test(b));
  ok("fieldId is prefixed ff", /^ff[a-z0-9]+-.{4}-.{6}$/.test(c));
  ok("ids embed the 4-char device fingerprint", a.split("-")[1] === "devA");
  ok("ids are unique across calls", formId() !== formId());
}

// ── 2. live filters hide tombstones ──
{
  const forms = [{id:"a",type:"form",name:"A"},{id:"b",type:"form",name:"B",deleted:1}];
  ok("formsLive hides a tombstoned template", formsLive(forms).map(x=>x.id).join(",") === "a");
  const subs = [{id:"s1",type:"formsub"},{id:"s2",type:"formsub",deleted:1}];
  ok("formDataLive hides a tombstoned submission", formDataLive(subs).map(x=>x.id).join(",") === "s1");
}

// ── 3. CSV splitter — quotes, commas/newlines inside quotes, escaped "", CRLF ──
{
  const rows = parseCsvRows('a,b,c\n1,2,3\r\n"x,y","he said ""hi""","line\nbreak"');
  ok("parseCsvRows row count (blank rows dropped)", rows.length === 3);
  ok("parseCsvRows header split", rows[0].join("|") === "a|b|c");
  ok("parseCsvRows CRLF handled", rows[1].join("|") === "1|2|3");
  ok("parseCsvRows comma inside quotes kept whole", rows[2][0] === "x,y");
  ok("parseCsvRows escaped double-quote", rows[2][1] === 'he said "hi"');
  ok("parseCsvRows newline inside quotes kept", rows[2][2] === "line\nbreak");
  ok("parseCsvRows on empty text → []", parseCsvRows("").length === 0);
}

// ── 4. type inference from a sample cell ──
{
  ok("inferFtype $ → dollar", inferFtype("$12.50") === "dollar");
  ok("inferFtype two-decimal → dollar", inferFtype("12.00") === "dollar");
  ok("inferFtype ISO date → date", inferFtype("2026-07-15") === "date");
  ok("inferFtype slash date → date", inferFtype("7/15/26") === "date");
  ok("inferFtype integer → number", inferFtype("42") === "number");
  ok("inferFtype yes/no → yesno", inferFtype("Yes") === "yesno");
  ok("inferFtype freeform → text", inferFtype("cooked at home") === "text");
  ok("inferFtype empty → text", inferFtype("") === "text");
}

// ── 5. CSV → template: headers become fields, types inferred, choice detected, rows kept ──
{
  const csv = "Date,Spent,Mood,Meal\n2026-07-13,$8.50,3,Cooked\n2026-07-14,$0,4,Ate out\n2026-07-15,$12,2,Cooked\n2026-07-16,$4,5,Both";
  const out = csvToTemplate(csv, "Daily journal");
  ok("csvToTemplate builds one field per header", out.template.fields.length === 4);
  ok("csvToTemplate names the template", out.template.name === "Daily journal");
  ok("csvToTemplate labels from headers", out.template.fields.map(f=>f.label).join(",") === "Date,Spent,Mood,Meal");
  ok("csvToTemplate infers date column", out.template.fields[0].ftype === "date");
  ok("csvToTemplate infers dollar column", out.template.fields[1].ftype === "dollar");
  ok("csvToTemplate infers number column", out.template.fields[2].ftype === "number");
  ok("csvToTemplate few-distinct text → choice", out.template.fields[3].ftype === "choice");
  ok("csvToTemplate choice carries the options", (out.template.fields[3].options||[]).sort().join(",") === "Ate out,Both,Cooked");
  ok("csvToTemplate hands back the data rows", out.rows.length === 4);
  ok("csvToTemplate every field gets an id", out.template.fields.every(f=>/^ff/.test(f.id)));
  ok("csvToTemplate ships at updated:0 (editor stamps on save)", out.template.updated === 0);
  ok("csvToTemplate empty CSV → null", csvToTemplate("") === null);
}

// ── 6. text → template: Q&A / label / checklist / scale heuristics ──
{
  const txt = [
    "Weight: 175",
    "How did you sleep?",
    "[ ] Took meds",
    "- Exercised",
    "Mood (1-5)",
    "Spent today: $20",
  ].join("\n");
  const out = textToTemplate(txt, "Morning page");
  const by = {}; out.template.fields.forEach(f => by[f.label] = f.ftype);
  ok("textToTemplate one field per line", out.template.fields.length === 6);
  ok("textToTemplate label:number-example → number", by["Weight"] === "number");
  ok("textToTemplate question → notes", by["How did you sleep?"] === "notes");
  ok("textToTemplate [ ] checkbox → yesno", by["Took meds"] === "yesno");
  ok("textToTemplate bullet → yesno", by["Exercised"] === "yesno");
  ok("textToTemplate (1-5) hint → scale", by["Mood"] === "scale");
  ok("textToTemplate label:$example → dollar", by["Spent today"] === "dollar");
  ok("textToTemplate no fields → null", textToTemplate("   \n  ") === null);
}

// ── 7. merge sanity (forms reuse mergeThings): concurrent edits to two forms both survive ──
{
  const base = [
    {id:"f1",type:"form",name:"Journal",updated:100,ord:0,ordAt:0,fields:[{id:"x",label:"A",ftype:"text"}]},
    {id:"f2",type:"form",name:"Workout",updated:100,ord:1,ordAt:0,fields:[]},
  ];
  const A = JSON.parse(JSON.stringify(base)); A[0].name="Journal v2"; A[0].updated=200;
  const B = JSON.parse(JSON.stringify(base)); B[1].name="Workout v2"; B[1].updated=200;
  const m = mergeThings(A, B);
  ok("concurrent edits to two templates both survive (f1)", m.find(x=>x.id==="f1").name === "Journal v2");
  ok("concurrent edits to two templates both survive (f2)", m.find(x=>x.id==="f2").name === "Workout v2");
}

// ── 8. submission merge: concurrent submissions survive; exact-tie tombstone wins ──
{
  const s = mergeThings(
    [{id:"d1",type:"formsub",formId:"f1",date:"2026-07-13",updated:1,ord:0,ordAt:0}],
    [{id:"d2",type:"formsub",formId:"f1",date:"2026-07-14",updated:1,ord:1,ordAt:0}]);
  ok("two submissions on different days both kept", formDataLive(s).length === 2);
  const t = mergeThings(
    [{id:"d1",type:"formsub",updated:5,ord:0,ordAt:0}],
    [{id:"d1",type:"formsub",updated:5,ord:0,ordAt:0,deleted:1}]);
  ok("exact tie: a deleted submission wins (no resurrection)", !!t.find(x=>x.id==="d1").deleted);
}

// ── 9. PARITY: webcache wMergeThings === app.js mergeThings on form/submission fixtures ──
{
  const fixtures = [
    [ [{id:"f",type:"form",updated:2,ord:0,ordAt:0,name:"A",emoji:"📋"}], [{id:"f",type:"form",updated:1,ord:0,ordAt:0,name:"old",emoji:"📝"}] ],
    [ [{id:"d",type:"formsub",updated:5,ord:3,ordAt:900}], [{id:"d",type:"formsub",updated:5,ord:1,ordAt:900}] ],
    [ [{id:"f",type:"form",updated:1,ord:0,ordAt:0,dated:1}], [{id:"f",type:"form",updated:1,ord:0,ordAt:0,dated:0}] ],
  ];
  let allEq = true;
  fixtures.forEach(([a,b]) => { if (JSON.stringify(mergeThings(a,b)) !== JSON.stringify(wMergeThings(a,b))) allEq = false; });
  ok("forms/formData merge is byte-identical across app.js + webcache.js", allEq);
}

console.log(`\n${p} passed, ${f} failed`); process.exit(f?1:0);
