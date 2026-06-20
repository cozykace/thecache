export type CategoryKey =
  | "income"
  | "housing"
  | "food"
  | "transport"
  | "music"
  | "art"
  | "social"
  | "health"
  | "subscriptions"
  | "shopping"
  | "transfer"
  | "other";

export interface Account {
  id: string;
  name: string;
  org: string;
  type: "checking" | "savings" | "credit" | "cash";
  balance: number;
}

export interface Txn {
  id: string;
  accountId: string;
  date: string; // ISO yyyy-mm-dd
  description: string;
  amount: number; // positive = money in, negative = money out
  category: CategoryKey;
}
