import { useEffect } from "react";
import {
  motion,
  useMotionValue,
  useTransform,
  animate,
} from "framer-motion";

// A 270° tachometer: hairline arc, tick marks, sweeping needle, digital readout.
// Sampled-point arc path (no SVG arc-flag ambiguity).

const CX = 100;
const CY = 100;
const R = 78;
const START = 225; // lower-left
const SPAN = 270; // clockwise to lower-right (-45)

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
}

function arcPath(r: number, t0: number, t1: number, steps = 64) {
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const deg = START - SPAN * (t0 + (t1 - t0) * (i / steps));
    const [x, y] = polar(CX, CY, r, deg);
    d += (i === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2) + " ";
  }
  return d.trim();
}

export function Gauge({
  label,
  value,
  max,
  color,
  format,
  delay = 0,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  format: (n: number) => string;
  delay?: number;
}) {
  const t = Math.max(0, Math.min(1, max === 0 ? 0 : value / max));

  // animate a 0..t motion value; derive needle endpoint from it
  const mv = useMotionValue(0);
  const nx = useTransform(mv, (p) => polar(CX, CY, R - 16, START - SPAN * p)[0]);
  const ny = useTransform(mv, (p) => polar(CX, CY, R - 16, START - SPAN * p)[1]);

  useEffect(() => {
    const c = animate(mv, t, { duration: 1.3, delay, ease: [0.16, 1, 0.3, 1] });
    return c.stop;
  }, [t, mv, delay]);

  const ticks = Array.from({ length: 11 }, (_, i) => i / 10);

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 150" className="w-full max-w-[220px]">
        {/* track */}
        <path
          d={arcPath(R, 0, 1)}
          fill="none"
          stroke="rgba(28,26,18,0.22)"
          strokeWidth={1}
        />
        {/* ticks */}
        {ticks.map((tt, i) => {
          const deg = START - SPAN * tt;
          const [x1, y1] = polar(CX, CY, R, deg);
          const [x2, y2] = polar(CX, CY, R - (i % 5 === 0 ? 9 : 5), deg);
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="rgba(28,26,18,0.4)"
              strokeWidth={i % 5 === 0 ? 1.4 : 0.8}
            />
          );
        })}
        {/* colored progress */}
        <motion.path
          d={arcPath(R, 0, 1)}
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: t }}
          transition={{ duration: 1.3, delay, ease: [0.16, 1, 0.3, 1] }}
        />
        {/* needle */}
        <motion.line
          x1={CX}
          y1={CY}
          x2={nx}
          y2={ny}
          stroke="#1C1A12"
          strokeWidth={1.6}
          strokeLinecap="round"
        />
        <circle cx={CX} cy={CY} r={4.5} fill="#ECE6D6" stroke="#1C1A12" strokeWidth={1.4} />
        <circle cx={CX} cy={CY} r={1.6} fill="#1C1A12" />
      </svg>
      <div className="-mt-2 text-center">
        <div className="tabular text-lg leading-none text-ink">{format(value)}</div>
        <div className="eyebrow mt-1.5 text-ink/55">{label}</div>
      </div>
    </div>
  );
}
