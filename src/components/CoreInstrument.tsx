import { motion } from "framer-motion";
import { CountUp } from "./CountUp";
import { usd } from "../lib/format";

// The cockpit's primary readout: net cash, ringed by radar dials + a sweep.
export function CoreInstrument({
  value,
  delta,
}: {
  value: number;
  delta: number; // this month's net change, for the status line
}) {
  const up = delta >= 0;
  // 60 tick marks around the outer ring
  const ticks = Array.from({ length: 60 }, (_, i) => i);

  return (
    <div className="relative mx-auto h-[300px] w-[300px] md:h-[360px] md:w-[360px]">
      {/* radar rings + sweep */}
      <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full">
        <circle cx="200" cy="200" r="196" fill="none" stroke="rgba(28,26,18,0.28)" strokeWidth="1" />
        <circle cx="200" cy="200" r="150" fill="none" stroke="rgba(28,26,18,0.16)" strokeWidth="1" strokeDasharray="2 4" />
        <circle cx="200" cy="200" r="104" fill="none" stroke="rgba(28,26,18,0.16)" strokeWidth="1" />

        {/* crosshair */}
        <line x1="200" y1="8" x2="200" y2="28" stroke="rgba(28,26,18,0.4)" strokeWidth="1" />
        <line x1="200" y1="372" x2="200" y2="392" stroke="rgba(28,26,18,0.4)" strokeWidth="1" />
        <line x1="8" y1="200" x2="28" y2="200" stroke="rgba(28,26,18,0.4)" strokeWidth="1" />
        <line x1="372" y1="200" x2="392" y2="200" stroke="rgba(28,26,18,0.4)" strokeWidth="1" />

        {/* outer ticks */}
        {ticks.map((i) => {
          const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
          const r1 = 196;
          const r2 = i % 5 === 0 ? 184 : 190;
          return (
            <line
              key={i}
              x1={200 + r1 * Math.cos(a)}
              y1={200 + r1 * Math.sin(a)}
              x2={200 + r2 * Math.cos(a)}
              y2={200 + r2 * Math.sin(a)}
              stroke="rgba(28,26,18,0.35)"
              strokeWidth={i % 5 === 0 ? 1.2 : 0.7}
            />
          );
        })}

        {/* slow radar sweep wedge */}
        <g style={{ transformOrigin: "200px 200px" }} className="animate-sweep">
          <path
            d="M200 200 L200 6 A194 194 0 0 1 318 60 Z"
            fill="#C9542E"
            opacity="0.07"
          />
          <line x1="200" y1="200" x2="200" y2="8" stroke="#C9542E" strokeWidth="1.2" opacity="0.5" />
        </g>
      </svg>

      {/* organic blob behind the number (thin line-art) */}
      <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full">
        <motion.path
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.6 }}
          transition={{ duration: 1.8, ease: "easeInOut" }}
          d="M200 96 C262 96 318 132 322 196 C326 258 270 300 200 302 C134 304 80 262 80 198 C80 138 140 96 200 96 Z"
          fill="none"
          stroke="#2747C9"
          strokeWidth="1"
        />
      </svg>

      {/* center readout */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="eyebrow whitespace-nowrap text-ink/55">Net cash on hand</div>
        <CountUp
          value={value}
          duration={1.6}
          className="tabular mt-1 whitespace-nowrap text-5xl font-semibold leading-none tracking-tight md:text-6xl"
        />
        <div
          className="mt-3 flex items-center gap-1.5 text-xs"
          style={{ color: up ? "#3F8F4E" : "#C9542E" }}
        >
          <span className="animate-blink">●</span>
          <span className="tabular">
            {up ? "▲" : "▼"} {usd(Math.abs(delta))} this month
          </span>
        </div>
      </div>
    </div>
  );
}
