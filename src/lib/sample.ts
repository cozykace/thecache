import type { Account, Txn, CategoryKey } from "./types";

// Deterministic sample data so the dashboard looks stable on every reload.
// "Today" is pinned so the demo is reproducible; real data replaces this later.
const TODAY = new Date("2026-06-19T00:00:00");

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n: number) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - n);
  return iso(d);
}

// tiny seeded PRNG (mulberry32) for stable "random" amounts
function rng(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(42);
const between = (lo: number, hi: number) =>
  Math.round((lo + rand() * (hi - lo)) * 100) / 100;

export const accounts: Account[] = [
  { id: "chk", name: "Everyday Checking", org: "Chase", type: "checking", balance: 1284.55 },
  { id: "sav", name: "Safety Net", org: "Ally", type: "savings", balance: 2150.0 },
  { id: "cash", name: "Gig Cash", org: "Cash App", type: "cash", balance: 312.0 },
  { id: "cc", name: "Sapphire Card", org: "Chase", type: "credit", balance: -842.18 },
];

let _id = 0;
const t = (
  accountId: string,
  date: string,
  description: string,
  amount: number,
  category: CategoryKey
): Txn => ({ id: `t${_id++}`, accountId, date, description, amount, category });

// [daysAgo, description, amount, category, accountId]
type Row = [number, string, number, CategoryKey, string];

const rows: Row[] = [
  // ---- Recurring rent ----
  [3, "Sunrise Apartments — Rent", -1450, "housing", "chk"],
  [33, "Sunrise Apartments — Rent", -1450, "housing", "chk"],

  // ---- Subscriptions + gym ----
  [6, "Spotify Premium", -11.99, "subscriptions", "cc"],
  [7, "Adobe Creative Cloud", -54.99, "subscriptions", "cc"],
  [9, "Planet Fitness", -24.99, "health", "chk"],
  [36, "Spotify Premium", -11.99, "subscriptions", "cc"],
  [37, "Adobe Creative Cloud", -54.99, "subscriptions", "cc"],
  [39, "Planet Fitness", -24.99, "health", "chk"],

  // ---- Day-job #1 (biweekly) ----
  [1, "Blue Bottle Coffee — Payroll", between(560, 640), "income", "chk"],
  [15, "Blue Bottle Coffee — Payroll", between(560, 640), "income", "chk"],
  [29, "Blue Bottle Coffee — Payroll", between(560, 640), "income", "chk"],
  [43, "Blue Bottle Coffee — Payroll", between(560, 640), "income", "chk"],
  [57, "Blue Bottle Coffee — Payroll", between(560, 640), "income", "chk"],

  // ---- Day-job #2 (biweekly, offset) ----
  [8, "Pixel & Pine Studio — Payroll", between(740, 880), "income", "chk"],
  [22, "Pixel & Pine Studio — Payroll", between(740, 880), "income", "chk"],
  [36, "Pixel & Pine Studio — Payroll", between(740, 880), "income", "chk"],
  [50, "Pixel & Pine Studio — Payroll", between(740, 880), "income", "chk"],

  // ---- Irregular income: gigs, art, royalties ----
  [4, "The Echo — Live Show Payout", 320, "income", "cash"],
  [11, "Bandcamp Sales", 84.5, "income", "chk"],
  [18, "Wedding Gig — DJ Set", 450, "income", "cash"],
  [24, "Etsy — Print Sale", 62.0, "income", "chk"],
  [27, "Spotify Royalties (DistroKid)", 38.17, "income", "chk"],
  [41, "Private Art Commission", 600, "income", "chk"],
  [46, "Open Mic Tips", 45, "income", "cash"],
  [55, "Bandcamp Sales", 119.0, "income", "chk"],

  // ---- Everyday spending ----
  [0, "Stumptown Coffee", -5.75, "food", "cc"],
  [0, "Trader Joe's", -63.42, "food", "chk"],
  [1, "Lyft", -14.2, "transport", "cc"],
  [2, "Guitar Center — Strings", -28.99, "music", "cc"],
  [2, "Chipotle", -13.85, "food", "cc"],
  [3, "Blick Art Materials", -47.3, "art", "cc"],
  [4, "Bar Tab — The Echo", -38.0, "social", "cash"],
  [5, "Uber Eats", -26.4, "food", "cc"],
  [6, "Shell Gas", -42.1, "transport", "cc"],
  [7, "Vinyl — Amoeba Music", -33.0, "music", "cc"],
  [8, "Whole Foods", -58.9, "food", "chk"],
  [9, "Movie Night", -22.0, "social", "cc"],
  [10, "Concert Ticket", -65.0, "social", "cc"],
  [12, "Trader Joe's", -54.12, "food", "chk"],
  [13, "Lyft", -18.6, "transport", "cc"],
  [14, "Coffee w/ friends", -11.25, "social", "cc"],
  [15, "Sweetgreen", -15.5, "food", "cc"],
  [16, "Sam Ash — Cables", -19.99, "music", "cc"],
  [17, "Target", -72.3, "shopping", "cc"],
  [19, "Trader Joe's", -48.77, "food", "chk"],
  [20, "Bar Tab", -44.0, "social", "cash"],
  [21, "Shell Gas", -39.5, "transport", "cc"],
  [23, "Art Print Frames", -36.0, "art", "cc"],
  [25, "Brunch", -29.0, "social", "cc"],
  [26, "Trader Joe's", -61.2, "food", "chk"],
  [28, "Lyft", -16.0, "transport", "cc"],
  [30, "New Headphones", -89.99, "music", "cc"],
  [31, "Pharmacy", -24.3, "health", "cc"],
  [34, "Trader Joe's", -52.4, "food", "chk"],
  [35, "Dinner out", -41.0, "social", "cc"],
  [38, "Canvas & Paint", -58.0, "art", "cc"],
  [40, "Shell Gas", -40.0, "transport", "cc"],
  [42, "Trader Joe's", -57.85, "food", "chk"],
  [44, "Concert Ticket", -55.0, "social", "cc"],
  [48, "Sweetgreen", -14.75, "food", "cc"],
  [52, "Trader Joe's", -49.6, "food", "chk"],
  [54, "Bar Tab", -36.0, "social", "cash"],
  [58, "Shell Gas", -41.2, "transport", "cc"],
];

export const transactions: Txn[] = rows
  .map(([off, desc, amt, cat, acct]) => t(acct, daysAgo(off), desc, amt, cat))
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

export const today = TODAY;
