import { diffDays } from "./dates";
import type { Progress } from "./progress";
import type { CampaignType } from "./results";

export type Finding = { level: "bad" | "warn" | "ok"; title: string; cause: string; action: string };

export type DailyPoint = { day: string; spend: number; results: number; impressions: number; clicks: number };
export type AdSetPoint = { name: string; effectiveStatus: string; spend: number; results: number };

export type DiagInput = {
  type: CampaignType;
  effectiveStatus: string;
  spend: number; result: number;
  cpr: number | null; prevCpr: number | null;       // CPR بصيغة النوع (Reach لكل 1000)
  frequency: number | null;
  progress: Progress;
  goalBudget: number | null;
  costLimit?: number | null;                         // حد التكلفة للعميل لهذا النوع (بصيغة النوع)
  daily: DailyPoint[];                               // مرتبة بالتاريخ
  adsets: AdSetPoint[];
  periodStart: string | null; periodEnd: string | null; today: string;
};

const sum = (rows: DailyPoint[]) => ({
  spend: rows.reduce((s, r) => s + r.spend, 0),
  results: rows.reduce((s, r) => s + r.results, 0),
  impressions: rows.reduce((s, r) => s + r.impressions, 0),
  clicks: rows.reduce((s, r) => s + r.clicks, 0),
  days: rows.length,
});
type Agg = ReturnType<typeof sum>;

const unitCpr = (type: CampaignType, a: { spend: number; results: number }) =>
  a.results > 0 ? (type === "reach" ? (a.spend / a.results) * 1000 : a.spend / a.results) : null;
const cpm = (a: Agg) => (a.impressions > 0 ? (a.spend / a.impressions) * 1000 : null);
const ctr = (a: Agg) => (a.impressions > 0 ? a.clicks / a.impressions : null);
const conv = (a: Agg) => (a.clicks > 0 ? a.results / a.clicks : null);
const pct = (n: number) => Math.round(n);
const money = (n: number) => "$" + (n < 0.01 ? n.toFixed(4) : n < 1 ? n.toFixed(3) : n.toFixed(2));
const TYPE_AR: Record<CampaignType, string> = { messages: "messages", reach: "reach", visit: "visits", engagement: "engagements", other: "results" };

function rc3(recent: Agg, before: Agg, ok: boolean, type: CampaignType): string {
  if (!ok) return "";
  const r = unitCpr(type, recent), b = unitCpr(type, before);
  return r !== null && b !== null && r > b * 1.1 ? `Up ${pct((r / b - 1) * 100)}% in the last ${recent.days} days.` : "";
}

export function diagnose(i: DiagInput): Finding[] {
  const out: Finding[] = [];
  const p = i.progress;
  const finished = p.status === "achieved";

  // أيام مكتملة فقط (اليوم الجاري جزئي)
  const done = i.daily.filter((d) => d.day < i.today);
  const recent = sum(done.slice(-3));
  const before = sum(done.slice(0, -3));
  const hasCompare = recent.days >= 2 && before.days >= 3;

  // 1) الحالة والتسليم
  if (i.effectiveStatus && i.effectiveStatus !== "ACTIVE") {
    out.push({
      level: "bad", title: `Campaign not active (${i.effectiveStatus})`,
      cause: "Spend is stopped, so no results.",
      action: "Reactivate it, or check why it stopped.",
    });
  } else if (done.length >= 2 && done.slice(-2).every((d) => d.spend === 0)) {
    out.push({
      level: "bad", title: "No spend for 2 days although active",
      cause: "Likely no delivery: ad in review or rejected, payment issue, or audience too narrow.",
      action: "Check ad sets and ads in Ads Manager → Delivery.",
    });
  }
  const sick = i.adsets.filter((a) => ["WITH_ISSUES", "DISAPPROVED", "PENDING_REVIEW", "IN_PROCESS"].includes(a.effectiveStatus));
  if (sick.length) {
    out.push({
      level: sick.some((a) => ["WITH_ISSUES", "DISAPPROVED"].includes(a.effectiveStatus)) ? "bad" : "warn",
      title: `Ad sets with issues: ${sick.map((a) => `${a.name} (${a.effectiveStatus})`).join(", ")}`,
      cause: "A rejected or in-review ad blocks full delivery.",
      action: "Fix or replace the affected ads.",
    });
  }

  // 2) الصرف: متأخر عن الخطة، أم مصروف لكن النتيجة متأخرة (الهدف عالٍ أو السعر عالٍ)
  const d2 = (n: number) => "$" + n.toFixed(2);
  if (i.goalBudget && p.total > 0 && p.elapsed >= 2 && i.effectiveStatus === "ACTIVE") {
    const planned = (i.goalBudget * Math.min(p.elapsed, p.total)) / p.total;
    // Behind on spend matters only when results are not on track (a lower price can make up the missing spend)
    const resultsOk = !!p.target && (p.status === "on_track" || p.status === "achieved");
    if (planned > 0 && i.spend < planned * 0.85 && !resultsOk) {
      const share = (i.spend / planned) * 100;
      const missing = planned - i.spend;
      const planDaily = i.goalBudget / p.total;
      const left = Math.max(0, i.goalBudget - i.spend);
      const needDaily = p.daysLeft && p.daysLeft > 0 ? left / p.daysLeft : null;
      out.push({
        level: share < 60 ? "bad" : "warn",
        title: `Spend is behind plan by ${d2(missing)} (${d2(i.spend)} of ${d2(planned)} planned to date)`,
        cause: `Plan is ${d2(planDaily)} per day, and the budget was not spent at that rate.`,
        action: needDaily !== null
          ? `Spend ${d2(needDaily)} per day (${needDaily >= planDaily ? "+" : "-"}${d2(Math.abs(needDaily - planDaily))}) for the ${p.daysLeft} days left, or add a catch-up campaign of ${d2(missing)}.`
          : `Add a catch-up campaign of ${d2(missing)}, or accept the shortfall.`,
      });
    } else if (i.goalBudget && i.spend > i.goalBudget) {
      out.push({
        level: "warn", title: `Spend exceeded campaign budget (${money(i.spend)} of ${money(i.goalBudget)})`,
        cause: "Ad set budgets are higher than the budget set here.",
        action: "Lower ad set budgets or update the campaign budget in Edit.",
      });
    }
    // Spend is on plan but results are late: either the target is too high for the budget, or the price is too high
    if (planned > 0 && i.spend >= planned * 0.85 && p.target && (p.status === "late" || p.status === "missed") && i.cpr !== null && i.type !== "other") {
      const k = i.type === "reach" ? 1000 : 1;
      const unit = i.type === "reach" ? " per 1000" : "";
      const req = (i.goalBudget / p.target) * k;             // cost that hits the target with the full budget
      if (i.cpr > req * 1.02) {
        const reach = ((i.goalBudget / i.cpr) * k / p.target) * 100;
        const budgetNeeded = (p.target / k) * i.cpr;
        const targetFit = (i.goalBudget / i.cpr) * k;
        const priceHigh = i.costLimit && i.costLimit > 0 ? i.cpr > i.costLimit : i.prevCpr ? i.cpr > i.prevCpr * 1.1 : null;
        const nf = (n: number) => Math.round(n).toLocaleString("en-US");
        if (priceHigh === true) {
          out.push({
            level: "bad",
            title: `Spend is on plan but results are late: price is high (${money(i.cpr)}${unit}${i.costLimit ? `, limit ${money(i.costLimit)}` : ""})`,
            cause: `At this price the ${money(i.goalBudget)} budget reaches about ${pct(reach)}% of the target; the target needs ${money(req)}${unit}.`,
            action: "Lower the cost (ads, audience, placements) to reach the target.",
          });
        } else if (priceHigh === false) {
          out.push({
            level: "bad",
            title: "Spend is on plan but results are late: target is too high for the budget",
            cause: `Price is normal (${money(i.cpr)}${unit}), but the target needs ${money(req)}${unit} with the ${money(i.goalBudget)} budget.`,
            action: `Raise the budget to about ${money(budgetNeeded)}, or lower the target to about ${nf(targetFit)}.`,
          });
        } else {
          out.push({
            level: "bad",
            title: "Spend is on plan but results are late: target is too high for the budget, or the price is high",
            cause: `The target needs ${money(req)}${unit} with the ${money(i.goalBudget)} budget; the current price is ${money(i.cpr)}${unit}.`,
            action: `Raise the budget to about ${money(budgetNeeded)}, lower the target to about ${nf(targetFit)}, or reduce the cost.`,
          });
        }
      }
    }
  }

  // 3) مشكلة التكلفة وتفكيكها: CPR = CPM ÷ (CTR × التحويل)
  if (hasCompare) {
    const rc = unitCpr(i.type, recent), bc = unitCpr(i.type, before);
    if (rc !== null && bc !== null && rc > bc * 1.2) {
      const worse = Math.round((rc / bc - 1) * 100);
      const parts: { k: string; r: number }[] = [];
      const rCpm = cpm(recent), bCpm = cpm(before), rCtr = ctr(recent), bCtr = ctr(before), rConv = conv(recent), bConv = conv(before);
      if (rCpm && bCpm) parts.push({ k: "cpm", r: rCpm / bCpm });
      if (rCtr && bCtr) parts.push({ k: "ctr", r: bCtr / rCtr });
      if (i.type !== "reach" && rConv && bConv) parts.push({ k: "conv", r: bConv / rConv });
      parts.sort((a, b) => b.r - a.r);
      const top = parts[0];
      let cause = "No single clear factor; small rises in several.";
      let action = "Watch 2 more days before changing anything.";
      if (top && top.r >= 1.15) {
        if (top.k === "cpm") {
          cause = `CPM rose ${pct((top.r - 1) * 100)}%: more competition, narrower audience, or season.`;
          action = "Widen the audience, enable Advantage+ placements, or test a new audience.";
        } else if (top.k === "ctr") {
          cause = `CTR fell ${pct((top.r - 1) * 100)}%: the ad is losing appeal (fatigue or weak hook).`;
          action = "Change the creative or hook, add a new ad.";
        } else {
          cause = `Clicks convert less (down ${pct((top.r - 1) * 100)}%): offer, post-click experience, or reply speed.`;
          action = i.type === "messages" ? "Review the welcome message, reply speed and offer." : "Review the destination and what users see after clicking.";
        }
      }
      if (finished) {
        out.push({
          level: "warn", title: `Target reached, but cost rose ${worse}% in the last ${recent.days} days (${money(rc)} vs ${money(bc)}${i.type === "reach" ? " per 1000" : ""})`,
          cause, action: `${action} ${p.balance && p.balance > 0 ? `To get the most from the remaining ${money(p.balance)}: fix the cause, move some to a late campaign, or stop it.` : ""}`.trim(),
        });
      } else
      out.push({ level: "bad", title: `Cost per result rose ${worse}% in the last ${recent.days} days (${money(rc)} vs ${money(bc)}${i.type === "reach" ? " per 1000" : ""})`, cause, action });
    }
  }
  if (i.cpr !== null && i.prevCpr && i.cpr > i.prevCpr * 1.2) {
    out.push({
      level: "warn", title: `Cost is ${pct((i.cpr / i.prevCpr - 1) * 100)}% higher than the previous period`,
      cause: "Auction, audience or ads changed since the previous period.",
      action: "Compare ads and audiences between periods and restore what worked.",
    });
  }

  // 4) التعب الإعلاني
  if (!finished && i.frequency !== null && i.type !== "reach") {
    const ctrDrop = hasCompare && ctr(recent) && ctr(before) ? (ctr(before)! / ctr(recent)!) : 1;
    if (i.frequency >= 2.5 && ctrDrop >= 1.15) {
      out.push({
        level: "bad", title: `Ad fatigue: frequency ${i.frequency.toFixed(1)} with falling CTR`,
        cause: "The audience has seen the ad too often.",
        action: "Add new creative or widen the audience.",
      });
    } else if (i.frequency >= 3.5) {
      out.push({
        level: "warn", title: `High frequency (${i.frequency.toFixed(1)})`,
        cause: "The audience is nearing saturation.", action: "Prepare new creative before results drop.",
      });
    }
  } else if (i.frequency !== null && i.type === "reach" && i.frequency >= 4) {
    out.push({
      level: "warn", title: `Frequency ${i.frequency.toFixed(1)} on a reach campaign`,
      cause: "The same people are being reached again.", action: "Widen the audience or lower the daily budget.",
    });
  }

  // 5) اتجاه النتائج
  if (!finished && hasCompare) {
    const rPer = recent.results / recent.days, bPer = before.results / before.days;
    if (bPer > 0 && rPer < bPer * 0.75) {
      out.push({
        level: "warn", title: `Daily results fell ${pct((1 - rPer / bPer) * 100)}% (${rPer.toFixed(1)} vs ${bPer.toFixed(1)} per day)`,
        cause: "Lower delivery, appeal, or ad fatigue.",
        action: "Review the weakest ads and ad sets with dropped spend.",
      });
    }
  }

  // 6) هل الوتيرة تكفي للهدف؟ الميزانية ثابتة، فالمتغير هو سعر النتيجة
  if (!finished && p.target && p.daysLeft !== null && p.daysLeft > 0 && done.length >= 2) {
    const remaining = p.target - i.result;
    const perDayNow = recent.days ? recent.results / recent.days : 0;
    const need = remaining / p.daysLeft;
    const label = TYPE_AR[i.type];
    const k = i.type === "reach" ? " per 1000" : "";
    if (remaining > 0 && perDayNow < need * 0.95) {
      const unit = i.cpr ?? unitCpr(i.type, { spend: i.spend, results: i.result });
      const req = p.balance !== null && p.balance > 0
        ? (i.type === "reach" ? p.balance / (remaining / 1000) : p.balance / remaining) : null;
      if (req !== null && unit !== null && unit > req * 1.02) {
        const cut = pct((1 - req / unit) * 100);
        const trend = i.prevCpr && unit > i.prevCpr * 1.05
          ? `Up ${pct((unit / i.prevCpr - 1) * 100)}% vs previous period (${money(i.prevCpr)}).`
          : rc3(recent, before, hasCompare, i.type) ;
        out.push({
          level: "bad",
          title: `Cost per result ${money(unit)}${k}; need ${money(req)}${k} to hit target with the remaining balance`,
          cause: `${Math.round(remaining).toLocaleString("en-US")} ${label} left in ${p.daysLeft} days with ${money(p.balance!)}. ${trend}`.trim(),
          action: `Cost must drop ≈ ${cut}% or the target will be missed.`,
        });
      } else {
        out.push({
          level: "warn",
          title: `Pace ${Math.round(perDayNow).toLocaleString("en-US")} ${label}/day, need ${Math.round(need).toLocaleString("en-US")}`,
          cause: `${Math.round(remaining).toLocaleString("en-US")} left in ${p.daysLeft} days; cost is fine but daily spend is too low.`,
          action: "Raise daily spend so the balance is used before the period ends.",
        });
      }
    }
  }

  // 7) أي مجموعة تسحب الأداء؟
  const live = i.adsets.filter((a) => a.spend > 0.5);
  if (!finished && live.length >= 2) {
    const totalSpend = live.reduce((s, a) => s + a.spend, 0);
    const withCpr = live.map((a) => ({ a, c: a.results > 0 ? a.spend / a.results : null }));
    const best = withCpr.filter((x) => x.c !== null).sort((x, y) => x.c! - y.c!)[0];
    const dead = withCpr.filter((x) => x.c === null && x.a.spend / totalSpend >= 0.2);
    if (dead.length) {
      out.push({
        level: "warn", title: `Ad set with no results uses ${pct((dead[0].a.spend / totalSpend) * 100)}% of spend: ${dead[0].a.name}`,
        cause: "Spent with no results so far.", action: "Pause it or move its budget to the best ad set.",
      });
    }
    const worst = withCpr.filter((x) => x.c !== null).sort((x, y) => y.c! - x.c!)[0];
    if (best && worst && worst.a.name !== best.a.name && worst.c! > best.c! * 1.5 && worst.a.spend / totalSpend >= 0.25) {
      out.push({
        level: "warn",
        title: `${worst.a.name} costs ${(worst.c! / best.c!).toFixed(1)}× more than ${best.a.name} and uses ${pct((worst.a.spend / totalSpend) * 100)}% of spend`,
        cause: "Weaker audience or creative.", action: `Move part of its budget to ${best.a.name} or pause it.`,
      });
    }
  }

  const order = { bad: 0, warn: 1, ok: 2 } as const;
  out.sort((a, b) => order[a.level] - order[b.level]);
  if (!out.length) {
    out.push({
      level: "ok",
      title: finished ? `Target reached${p.target ? ` (${Math.round((i.result / p.target) * 100)}%)` : ""} — cost stable` : p.target ? "No issues — on pace" : "No issues in delivery or cost",
      cause: "", action: finished ? "You can stop it or move its budget to a late campaign." : p.target ? "" : "Set a target to see progress.",
    });
  }
  return out.slice(0, 6);
}

// يُستخدم لحساب أيام الفترة المنقضية خارج هذا الملف إن لزم
export const daysBetween = diffDays;
