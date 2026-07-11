export const spendingByDay = [
  { day: "01/07", expense: 240000, budget: 420000 },
  { day: "02/07", expense: 310000, budget: 420000 },
  { day: "03/07", expense: 180000, budget: 420000 },
  { day: "04/07", expense: 460000, budget: 420000 },
  { day: "05/07", expense: 390000, budget: 420000 },
  { day: "06/07", expense: 520000, budget: 420000 },
  { day: "07/07", expense: 280000, budget: 420000 },
  { day: "08/07", expense: 610000, budget: 420000 },
  { day: "09/07", expense: 345000, budget: 420000 },
  { day: "10/07", expense: 430000, budget: 420000 },
  { day: "11/07", expense: 290000, budget: 420000 },
  { day: "12/07", expense: 385000, budget: 420000 },
];

export const categorySpending = [
  { name: "Food & Coffee", value: 2450000, color: "#10b981" },
  { name: "Transport", value: 1380000, color: "#3b82f6" },
  { name: "Shopping", value: 1960000, color: "#f59e0b" },
  { name: "Subscriptions", value: 720000, color: "#8b5cf6" },
  { name: "Utilities", value: 1140000, color: "#ef4444" },
];

export const transactions = [
  {
    id: "TX-4108",
    store: "Circle K",
    date: "08/07/2026",
    category: "Convenience",
    amount: 126000,
    method: "Visa Debit",
    status: "ANALYZED",
  },
  {
    id: "TX-4107",
    store: "Highlands Coffee",
    date: "08/07/2026",
    category: "Coffee",
    amount: 89000,
    method: "Momo",
    status: "ANALYZED",
  },
  {
    id: "TX-4106",
    store: "Grab",
    date: "07/07/2026",
    category: "Transport",
    amount: 214000,
    method: "Visa Debit",
    status: "WARNING",
  },
  {
    id: "TX-4105",
    store: "Netflix",
    date: "06/07/2026",
    category: "Subscription",
    amount: 260000,
    method: "Mastercard",
    status: "ANALYZED",
  },
  {
    id: "TX-4104",
    store: "Shopee",
    date: "05/07/2026",
    category: "Shopping",
    amount: 840000,
    method: "Bank Transfer",
    status: "WARNING",
  },
  {
    id: "TX-4103",
    store: "WinMart",
    date: "04/07/2026",
    category: "Groceries",
    amount: 352000,
    method: "Cash",
    status: "PENDING",
  },
  {
    id: "TX-4102",
    store: "Guardian",
    date: "03/07/2026",
    category: "Healthcare",
    amount: 178000,
    method: "Visa Debit",
    status: "ANALYZED",
  },
];

export const budgets = [
  {
    category: "Food & Coffee",
    spent: 2450000,
    limit: 2200000,
    tone: "danger",
    note: "Highlands and convenience store runs are above the weekly rhythm.",
  },
  {
    category: "Transport",
    spent: 1380000,
    limit: 1500000,
    tone: "ok",
    note: "Grab rides are within range, but two late-night trips stand out.",
  },
  {
    category: "Shopping",
    spent: 1960000,
    limit: 1800000,
    tone: "warning",
    note: "Shopee spending crossed the monthly guardrail by 8.9%.",
  },
];

export const subscriptionAnomalies = [
  {
    name: "Netflix",
    amount: 260000,
    issue: "Plan fee increased compared with last month.",
    severity: "warning",
  },
  {
    name: "Canva Pro",
    amount: 320000,
    issue: "Annual renewal expected in 3 days.",
    severity: "pending",
  },
  {
    name: "Spotify",
    amount: 59000,
    issue: "Duplicate charge not detected this month.",
    severity: "ok",
  },
];

export const ocrText = `HIGHLANDS COFFEE
Vincom Center Dong Khoi
Date: 08/07/2026 - 09:18

1 x Phin Sua Da                  39,000
1 x Banh Mi Que                  35,000
1 x Tra Sen Vang                 49,000

Subtotal                        123,000
VAT                               9,840
Total                           132,840 VNĐ
Paid by Momo`;

export const aiResult = {
  store_name: "Highlands Coffee",
  total_amount: 132840,
  category: "Food & Coffee",
  confidence: 94,
  ai_advice:
    "Coffee spending is 18% above your weekday baseline. Try setting a 450,000 VNĐ weekly coffee cap and keep premium drinks for two chosen days.",
};

