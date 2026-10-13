import { diffDays, addDays } from "./dates";
import type { CampaignType } from "./results";

export type ProgressStatus = "achieved" | "on_track" | "late" | "missed" | "no_target";

export type ProgressInput = {
  type: CampaignType;
  periodStart: string | null; periodEnd: string | null; today: string;
  result: number; spend: number;
  goalTarget: number | null;       // الهدف الذي يكتبه المستخدم (نتيجة نوع الحملة نفسه)
  goalBudget: number | null;       // ميزانية الحملة
  threshold: number;               // 95
};

export type Progress = {
  target: number | null;
  pct: number | null; expected: number | null; forecast: number | null;
  status: ProgressStatus;
  elapsed: number; total: number; daysLeft: number | null;
  budget: number | null; balance: number | null;
};

export function periodLength(start: string | null, end: string | null): number {
  return start && end ? Math.max(1, diffDays(start, end) + 1) : 0;
}

const shiftMonthBack = (d: string): string => {
  const y = +d.slice(0, 4), m = +d.slice(5, 7), day = +d.slice(8, 10);
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return `${py}-${String(pm).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
};

/**
 * الفترة السابقة: للفترات الشهرية (27–32 يوماً) نفس التواريخ قبل شهر (9/1–9/30 ← 8/1–8/30)،
 * وغير ذلك نفس الطول مباشرة قبل البداية.
 */
export function previousPeriod(start: string, end: string): { from: string; to: string } {
  const len = periodLength(start, end);
  if (len >= 27 && len <= 32) return { from: shiftMonthBack(start), to: shiftMonthBack(end) };
  const to = addDays(start, -1);
  return { from: addDays(to, -(len - 1)), to };
}

export function computeProgress(i: ProgressInput): Progress {
  const total = periodLength(i.periodStart, i.periodEnd);
  const elapsed = i.periodStart ? Math.min(total || 1e9, Math.max(0, diffDays(i.periodStart, i.today) + 1)) : 0;
  const daysLeft = i.periodEnd ? Math.max(0, diffDays(i.today, i.periodEnd)) : null;
  const budget = i.goalBudget && i.goalBudget > 0 ? i.goalBudget : null;
  const balance = budget !== null ? Math.max(0, budget - i.spend) : null;
  const forecast = elapsed > 0 && total > 0 ? (i.result / elapsed) * total : null;
  const base = { elapsed, total, daysLeft, budget, balance };

  const target = i.goalTarget && i.goalTarget > 0 ? i.goalTarget : null;
  if (target === null) {
    return { target: null, pct: null, expected: null, forecast, status: "no_target", ...base };
  }
  // المتوقع حتى اليوم = الهدف × الأيام المنقضية ÷ طول الفترة؛ متأخرة إذا النتيجة < threshold% منه
  const pct = (i.result / target) * 100;
  const expected = total > 0 ? (target * Math.min(elapsed, total)) / total : null;
  let status: ProgressStatus;
  if (i.result >= target) status = "achieved";
  else if (daysLeft === 0 && i.periodEnd) status = "missed";
  else if (expected !== null && i.result < (expected * i.threshold) / 100) status = "late";
  else status = "on_track";
  return { target, pct, expected, forecast, status, ...base };
}
