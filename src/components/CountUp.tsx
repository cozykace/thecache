import { useEffect } from "react";
import { useMotionValue, useTransform, animate, motion } from "framer-motion";
import { usd } from "../lib/format";

export function CountUp({
  value,
  format,
  cents = false,
  duration = 1.2,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  cents?: boolean;
  duration?: number;
  className?: string;
}) {
  const mv = useMotionValue(0);
  const fmt = format ?? ((v: number) => usd(v, { cents }));
  const text = useTransform(mv, fmt);

  useEffect(() => {
    const controls = animate(mv, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
    });
    return controls.stop;
  }, [value, mv, duration]);

  return <motion.span className={className}>{text}</motion.span>;
}
