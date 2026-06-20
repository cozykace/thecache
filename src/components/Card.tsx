import { motion } from "framer-motion";
import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
      className={`glass rounded-3xl p-5 ${className}`}
    >
      {children}
    </motion.div>
  );
}
