export const usd = (n: number, opts: { cents?: boolean } = {}) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  }).format(n);

export const signedUsd = (n: number, opts: { cents?: boolean } = {}) =>
  (n >= 0 ? "+" : "−") + usd(Math.abs(n), opts);

export const shortDate = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

export const dayLabel = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
  });
