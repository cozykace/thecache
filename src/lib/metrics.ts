import type { Account, Txn, CategoryKey } from "./types";

export function netCash(accounts: Account[]) {
  // Liquid cash across checking/savings/cash, minus credit card debt.
  return accounts.reduce((s, a) => s + a.balance, 0);
}

export function isSameMonth(iso: string, ref: Date) {
  const d = new Date(iso + "T00:00:00");
  return d.getMonth() === ref.getMonth() && d.getFullYear() === ref.getFullYear();
}

export function monthSummary(txns: Txn[], ref: Date) {
  let income = 0;
  let spending = 0;
  for (const tx of txns) {
    if (!isSameMonth(tx.date, ref)) continue;
    if (tx.category === "transfer") continue;
    if (tx.amount >= 0) income += tx.amount;
    else spending += -tx.amount;
  }
  return { income, spending, net: income - spending };
}

export function spendingByCategory(txns: Txn[], ref: Date) {
  const map = new Map<CategoryKey, number>();
  for (const tx of txns) {
    if (!isSameMonth(tx.date, ref)) continue;
    if (tx.amount >= 0 || tx.category === "transfer") continue;
    map.set(tx.category, (map.get(tx.category) ?? 0) + -tx.amount);
  }
  return [...map.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export function burnPerDay(txns: Txn[], ref: Date) {
  const { spending } = monthSummary(txns, ref);
  const dayOfMonth = ref.getDate();
  return spending / Math.max(1, dayOfMonth);
}

export function runwayDays(netCashOnHand: number, perDay: number) {
  if (perDay <= 0) return 999;
  return netCashOnHand / perDay;
}

export function savingsRate(income: number, spending: number) {
  if (income <= 0) return 0;
  return ((income - spending) / income) * 100;
}

// Daily running cash balance over the last `days`, working backward from
// the current net cash. Used for the hero cashflow chart.
export function cashflowSeries(accounts: Account[], txns: Txn[], days: number) {
  const end = netCash(accounts);
  const out: { date: string; balance: number }[] = [];

  // bucket txn deltas by date
  const byDate = new Map<string, number>();
  for (const tx of txns) {
    if (tx.category === "transfer") continue;
    byDate.set(tx.date, (byDate.get(tx.date) ?? 0) + tx.amount);
  }

  let running = end;
  const cursor = new Date();
  for (let i = 0; i < days; i++) {
    const iso = cursor.toISOString().slice(0, 10);
    out.unshift({ date: iso, balance: Math.round(running * 100) / 100 });
    // step backward: remove today's net change to get yesterday's close
    running -= byDate.get(iso) ?? 0;
    cursor.setDate(cursor.getDate() - 1);
  }
  return out;
}
