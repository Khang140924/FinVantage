import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { categorySpending, spendingByDay } from "../data/mockData.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { formatCurrency } from "../utils/format.js";

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-soft dark:border-slate-700 dark:bg-slate-900">
      <p className="mb-1 font-semibold text-slate-900 dark:text-white">{label}</p>
      {payload.map((item) => (
        <p key={item.dataKey ?? item.name} className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
          {item.name}: <span className="font-semibold">{formatCurrency(item.value)}</span>
        </p>
      ))}
    </div>
  );
}

function PieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const item = payload[0];

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-soft dark:border-slate-700 dark:bg-slate-900">
      <p className="font-semibold text-slate-900 dark:text-white">{item.name}</p>
      <p className="text-slate-600 dark:text-slate-300">{formatCurrency(item.value)}</p>
    </div>
  );
}

export function ExpenseLineChart({ data = spendingByDay }) {
  const { t } = useLanguage();

  return (
    <ResponsiveContainer width="100%" height={320}>
      <AreaChart data={data} margin={{ top: 12, right: 18, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.28} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: "#64748b", fontSize: 12 }} />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={{ fill: "#64748b", fontSize: 12 }}
          tickFormatter={(value) => `${Math.round(value / 1000)}k`}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#10b981", strokeWidth: 1 }} />
        <Area
          type="monotone"
          name={t("dashboard.dailyExpense")}
          dataKey="expense"
          stroke="#10b981"
          strokeWidth={3}
          fill="url(#expenseGradient)"
          activeDot={{ r: 5, stroke: "#ffffff", strokeWidth: 2 }}
          isAnimationActive
          animationDuration={900}
        />
        <Area
          type="monotone"
          name={t("dashboard.dailyBudget")}
          dataKey="budget"
          stroke="#94a3b8"
          strokeWidth={2}
          fill="transparent"
          strokeDasharray="5 5"
          isAnimationActive
          animationDuration={900}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CategoryDonutChart({ data = categorySpending }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <PieChart>
        <Tooltip content={<PieTooltip />} />
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={72}
          outerRadius={112}
          paddingAngle={4}
          cornerRadius={6}
          isAnimationActive
          animationDuration={900}
        >
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.color} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}
