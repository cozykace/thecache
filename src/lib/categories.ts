import {
  Banknote,
  Home,
  UtensilsCrossed,
  Car,
  Music,
  Palette,
  PartyPopper,
  HeartPulse,
  Repeat,
  ShoppingBag,
  ArrowLeftRight,
  CircleDashed,
  type LucideIcon,
} from "lucide-react";
import type { CategoryKey } from "./types";

export const CATEGORIES: Record<
  CategoryKey,
  { label: string; color: string; icon: LucideIcon }
> = {
  income: { label: "Income", color: "#34d399", icon: Banknote },
  housing: { label: "Housing", color: "#60a5fa", icon: Home },
  food: { label: "Food & Drink", color: "#fbbf24", icon: UtensilsCrossed },
  transport: { label: "Transport", color: "#5eead4", icon: Car },
  music: { label: "Music", color: "#a78bfa", icon: Music },
  art: { label: "Art Supplies", color: "#f472b6", icon: Palette },
  social: { label: "Social Life", color: "#fb7185", icon: PartyPopper },
  health: { label: "Health", color: "#4ade80", icon: HeartPulse },
  subscriptions: { label: "Subscriptions", color: "#818cf8", icon: Repeat },
  shopping: { label: "Shopping", color: "#facc15", icon: ShoppingBag },
  transfer: { label: "Transfer", color: "#94a3b8", icon: ArrowLeftRight },
  other: { label: "Other", color: "#64748b", icon: CircleDashed },
};
