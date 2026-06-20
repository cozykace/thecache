import {
  AreaChart,
  Area,
  ResponsiveContainer,
  Tooltip,
  YAxis,
  XAxis,
} from "recharts";
import { usd, shortDate } from "../lib/format";

export function CashflowChart({
  data,
}: {
  data: { date: string; balance: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={150}>
      <AreaChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="cf" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5eead4" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#5eead4" stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={["dataMin - 200", "dataMax + 200"]} />
        <XAxis dataKey="date" hide />
        <Tooltip
          cursor={{ stroke: "rgba(255,255,255,0.2)", strokeWidth: 1 }}
          contentStyle={{
            background: "rgba(16,16,24,0.9)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 12,
            backdropFilter: "blur(8px)",
            color: "#fff",
          }}
          labelFormatter={(d) => shortDate(String(d))}
          formatter={(v: number) => [usd(v, { cents: true }), "Balance"]}
        />
        <Area
          type="monotone"
          dataKey="balance"
          stroke="#5eead4"
          strokeWidth={2.5}
          fill="url(#cf)"
          animationDuration={1200}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
