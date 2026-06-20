import type { Txn } from "../lib/types";
import { signedUsd, shortDate } from "../lib/format";

// Marquee tape — recent transactions scrolling like an old stock ticker.
export function Ticker({ txns }: { txns: Txn[] }) {
  const items = txns.slice(0, 16);
  const Row = () => (
    <div className="flex shrink-0">
      {items.map((tx) => {
        const inflow = tx.amount >= 0;
        return (
          <span
            key={tx.id}
            className="flex items-center whitespace-nowrap px-4 text-xs"
          >
            <span className="text-ink/40">{shortDate(tx.date)}</span>
            <span className="mx-2 text-ink/80">{tx.description}</span>
            <span
              className="tabular"
              style={{ color: inflow ? "#3F8F4E" : "#C9542E" }}
            >
              {signedUsd(tx.amount)}
            </span>
            <span className="ml-4 text-ink/25">◦</span>
          </span>
        );
      })}
    </div>
  );

  return (
    <div className="brackets frame overflow-hidden py-2">
      <div className="flex w-max animate-marquee">
        <Row />
        <Row />
      </div>
    </div>
  );
}
