const TZ = process.env.APP_TIMEZONE || "Asia/Baghdad";

/** تاريخ اليوم (YYYY-MM-DD) بتوقيت بغداد */
export function todayStr(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

const toUTC = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));

export function addDays(s: string, n: number): string {
  return new Date(toUTC(s) + n * 86400000).toISOString().slice(0, 10);
}

/** عدد الأيام من a إلى b (b - a) */
export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

export function minDate(a: string, b: string) { return a <= b ? a : b; }
export function maxDate(a: string, b: string) { return a >= b ? a : b; }

/** الأيام المتبقية في فترة العميل (0 = انتهت) */
export function daysLeft(periodEnd: string | null, today = todayStr()): number | null {
  if (!periodEnd) return null;
  return Math.max(0, diffDays(today, periodEnd));
}
