import { motion } from "framer-motion";

// ── BRICK 1 ──────────────────────────────────────────────
// One honest number. No fake demo data. This is the base we
// build on. In Brick 2 the SimpleFIN data stream replaces the
// placeholder and `balance` becomes your real total.
// ─────────────────────────────────────────────────────────

const balance: number | null = null; // null = no data stream yet

export default function App() {
  const connected = balance !== null;

  return (
    <div className="flex min-h-full items-center justify-center font-mono text-ink">
      {/* faint organic form behind the number — gently alien, not military */}
      <svg
        className="pointer-events-none absolute h-[460px] w-[460px] opacity-40"
        viewBox="0 0 460 460"
        aria-hidden
      >
        <motion.path
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 2.2, ease: "easeInOut" }}
          d="M230 70
             C320 70 392 120 398 210
             C404 300 340 380 250 388
             C150 397 70 340 64 240
             C58 150 140 70 230 70 Z"
          fill="none"
          stroke="#6A4BC4"
          strokeWidth="1"
        />
        <motion.circle
          cx="230"
          cy="230"
          r="150"
          fill="none"
          stroke="#2747C9"
          strokeWidth="1"
          strokeDasharray="1 7"
          initial={{ rotate: 0, opacity: 0 }}
          animate={{ rotate: 360, opacity: 0.6 }}
          transition={{
            rotate: { duration: 120, ease: "linear", repeat: Infinity },
            opacity: { duration: 2 },
          }}
          style={{ transformOrigin: "230px 230px" }}
        />
      </svg>

      <div className="relative flex flex-col items-center text-center">
        <div className="eyebrow text-ink/50">Total balance</div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="tabular mt-2 text-6xl font-semibold tracking-tight md:text-7xl"
        >
          {connected ? `$${balance!.toLocaleString()}` : "—"}
        </motion.div>

        <div className="eyebrow mt-5 flex items-center gap-2 text-ink/40">
          <span
            className={connected ? "text-green" : "text-clay animate-blink"}
          >
            ●
          </span>
          {connected ? "Live" : "No data stream yet · Brick 2 connects it"}
        </div>
      </div>

      <div className="eyebrow fixed bottom-5 left-1/2 -translate-x-1/2 text-ink/30">
        MONEY · LOCAL · v0.1
      </div>
    </div>
  );
}
