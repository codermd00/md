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
// Arabic text is shown right-to-left: isolate numbers and names so "$0.02" and English names keep their order
const LTR = (t: string) => "\u2066" + t + "\u2069";
const money = (n: number) => LTR("$" + (n < 0.01 ? n.toFixed(4) : n < 1 ? n.toFixed(3) : n.toFixed(2)));
const TYPE_AR: Record<CampaignType, string> = { messages: "رسائل", reach: "وصول", visit: "زيارات", engagement: "تفاعلات", other: "نتائج" };

function rc3(recent: Agg, before: Agg, ok: boolean, type: CampaignType): string {
  if (!ok) return "";
  const r = unitCpr(type, recent), b = unitCpr(type, before);
  return r !== null && b !== null && r > b * 1.1 ? `ارتفاع ${pct((r / b - 1) * 100)}% في آخر ${recent.days} أيام.` : "";
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
      level: "bad", title: `الحملة غير فعّالة (${LTR(i.effectiveStatus)})`,
      cause: "الصرف متوقف، لذلك لا توجد نتائج.",
      action: "أعد تشغيلها، أو افحص سبب توقفها.",
    });
  } else if (done.length >= 2 && done.slice(-2).every((d) => d.spend === 0)) {
    out.push({
      level: "bad", title: "لا يوجد صرف منذ يومين رغم أن الحملة فعّالة",
      cause: "غالباً لا يوجد تسليم: الإعلان قيد المراجعة أو مرفوض، أو مشكلة في الدفع، أو الجمهور ضيق جداً.",
      action: "افحص الـ Ad sets والإعلانات في Ads Manager (عمود Delivery).",
    });
  }
  const sick = i.adsets.filter((a) => ["WITH_ISSUES", "DISAPPROVED", "PENDING_REVIEW", "IN_PROCESS"].includes(a.effectiveStatus));
  if (sick.length) {
    out.push({
      level: sick.some((a) => ["WITH_ISSUES", "DISAPPROVED"].includes(a.effectiveStatus)) ? "bad" : "warn",
      title: `Ad sets فيها مشاكل: ${sick.map((a) => `${LTR(a.name)} (${LTR(a.effectiveStatus)})`).join("، ")}`,
      cause: "إعلان مرفوض أو قيد المراجعة يمنع التسليم الكامل.",
      action: "عالج الإعلانات المتأثرة أو استبدلها.",
    });
  }

  // 2) الصرف: متأخر عن الخطة، أم مصروف لكن النتيجة متأخرة (الهدف عالٍ أو السعر عالٍ)
  const d2 = (n: number) => LTR("$" + n.toFixed(2));
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
        title: `الصرف متأخر عن الخطة بمقدار ${d2(missing)} (صُرف ${d2(i.spend)} من ${d2(planned)} المخطط حتى اليوم)`,
        cause: `الخطة ${d2(planDaily)} يومياً، والميزانية لم تُصرف بهذا المعدل.`,
        action: needDaily !== null
          ? `اصرف ${d2(needDaily)} يومياً (${needDaily >= planDaily ? "زيادة" : "نقص"} ${d2(Math.abs(needDaily - planDaily))}) للأيام المتبقية (${p.daysLeft})، أو أضف حملة تعويض بمبلغ ${d2(missing)}.`
          : `أضف حملة تعويض بمبلغ ${d2(missing)}، أو اقبل النقص.`,
      });
    } else if (i.goalBudget && i.spend > i.goalBudget) {
      out.push({
        level: "warn", title: `الصرف تجاوز ميزانية الحملة (${money(i.spend)} من ${money(i.goalBudget)})`,
        cause: "ميزانيات الـ Ad sets أعلى من الميزانية المحددة هنا.",
        action: "خفّض ميزانيات الـ Ad sets أو حدّث ميزانية الحملة من Edit.",
      });
    }
    // Spend is on plan but results are late: either the target is too high for the budget, or the price is too high
    if (planned > 0 && i.spend >= planned * 0.85 && p.target && (p.status === "late" || p.status === "missed") && i.cpr !== null && i.type !== "other") {
      const k = i.type === "reach" ? 1000 : 1;
      const unit = i.type === "reach" ? " لكل 1000" : "";
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
            title: `الصرف على الخطة لكن النتائج متأخرة: السعر مرتفع (${money(i.cpr)}${unit}${i.costLimit ? `، الحد ${money(i.costLimit)}` : ""})`,
            cause: `بهذا السعر تصل ميزانية ${money(i.goalBudget)} إلى حوالي ${pct(reach)}% من الهدف؛ والهدف يحتاج ${money(req)}${unit}.`,
            action: "اخفض التكلفة (الإعلانات، الجمهور، المواضع) للوصول إلى الهدف.",
          });
        } else if (priceHigh === false) {
          out.push({
            level: "bad",
            title: "الصرف على الخطة لكن النتائج متأخرة: الهدف أعلى من الميزانية",
            cause: `السعر طبيعي (${money(i.cpr)}${unit})، لكن الهدف يحتاج ${money(req)}${unit} مع ميزانية ${money(i.goalBudget)}.`,
            action: `ارفع الميزانية إلى حوالي ${money(budgetNeeded)}، أو اخفض الهدف إلى حوالي ${nf(targetFit)}.`,
          });
        } else {
          out.push({
            level: "bad",
            title: "الصرف على الخطة لكن النتائج متأخرة: الهدف أعلى من الميزانية أو السعر مرتفع",
            cause: `الهدف يحتاج ${money(req)}${unit} مع ميزانية ${money(i.goalBudget)}؛ والسعر الحالي ${money(i.cpr)}${unit}.`,
            action: `ارفع الميزانية إلى حوالي ${money(budgetNeeded)}، أو اخفض الهدف إلى حوالي ${nf(targetFit)}، أو اخفض التكلفة.`,
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
      let cause = "لا يوجد عامل واحد واضح؛ ارتفاعات صغيرة في عدة عوامل.";
      let action = "راقب يومين إضافيين قبل تغيير أي شيء.";
      if (top && top.r >= 1.15) {
        if (top.k === "cpm") {
          cause = `ارتفع الـ CPM بنسبة ${pct((top.r - 1) * 100)}%: منافسة أكثر، أو جمهور أضيق، أو موسم.`;
          action = "وسّع الجمهور، فعّل Advantage+ placements، أو جرّب جمهوراً جديداً.";
        } else if (top.k === "ctr") {
          cause = `انخفض الـ CTR بنسبة ${pct((top.r - 1) * 100)}%: الإعلان يفقد جاذبيته (إرهاق أو hook ضعيف).`;
          action = "غيّر التصميم أو الـ hook، وأضف إعلاناً جديداً.";
        } else {
          cause = `النقرات تتحول بشكل أقل (انخفاض ${pct((top.r - 1) * 100)}%): العرض، أو تجربة ما بعد النقر، أو سرعة الرد.`;
          action = i.type === "messages" ? "راجع رسالة الترحيب وسرعة الرد والعرض." : "راجع وجهة النقر وما يراه المستخدم بعدها.";
        }
      }
      if (finished) {
        out.push({
          level: "warn", title: `تحقق الهدف، لكن التكلفة ارتفعت ${worse}% في آخر ${recent.days} أيام (${money(rc)} مقابل ${money(bc)}${i.type === "reach" ? " لكل 1000" : ""})`,
          cause, action: `${action} ${p.balance && p.balance > 0 ? `للاستفادة من المتبقي ${money(p.balance)}: عالج السبب، أو انقل جزءاً منه إلى حملة متأخرة، أو أوقفها.` : ""}`.trim(),
        });
      } else
      out.push({ level: "bad", title: `تكلفة النتيجة ارتفعت ${worse}% في آخر ${recent.days} أيام (${money(rc)} مقابل ${money(bc)}${i.type === "reach" ? " لكل 1000" : ""})`, cause, action });
    }
  }
  if (i.cpr !== null && i.prevCpr && i.cpr > i.prevCpr * 1.2) {
    out.push({
      level: "warn", title: `التكلفة أعلى بنسبة ${pct((i.cpr / i.prevCpr - 1) * 100)}% من الفترة السابقة`,
      cause: "تغيّر المزاد أو الجمهور أو الإعلانات منذ الفترة السابقة.",
      action: "قارن الإعلانات والجماهير بين الفترتين وأعد ما كان ناجحاً.",
    });
  }

  // 4) التعب الإعلاني
  if (!finished && i.frequency !== null && i.type !== "reach") {
    const ctrDrop = hasCompare && ctr(recent) && ctr(before) ? (ctr(before)! / ctr(recent)!) : 1;
    if (i.frequency >= 2.5 && ctrDrop >= 1.15) {
      out.push({
        level: "bad", title: `إرهاق إعلاني: التكرار ${i.frequency.toFixed(1)} مع انخفاض الـ CTR`,
        cause: "الجمهور شاهد الإعلان مرات كثيرة.",
        action: "أضف تصميماً جديداً أو وسّع الجمهور.",
      });
    } else if (i.frequency >= 3.5) {
      out.push({
        level: "warn", title: `تكرار مرتفع (${i.frequency.toFixed(1)})`,
        cause: "الجمهور يقترب من التشبع.", action: "جهّز تصميماً جديداً قبل أن تنخفض النتائج.",
      });
    }
  } else if (i.frequency !== null && i.type === "reach" && i.frequency >= 4) {
    out.push({
      level: "warn", title: `التكرار ${i.frequency.toFixed(1)} في حملة Reach`,
      cause: "يتم الوصول إلى نفس الأشخاص مرة أخرى.", action: "وسّع الجمهور أو خفّض الميزانية اليومية.",
    });
  }

  // 5) اتجاه النتائج
  if (!finished && hasCompare) {
    const rPer = recent.results / recent.days, bPer = before.results / before.days;
    if (bPer > 0 && rPer < bPer * 0.75) {
      out.push({
        level: "warn", title: `النتائج اليومية انخفضت ${pct((1 - rPer / bPer) * 100)}% (${rPer.toFixed(1)} مقابل ${bPer.toFixed(1)} يومياً)`,
        cause: "انخفاض التسليم أو الجاذبية، أو إرهاق إعلاني.",
        action: "راجع أضعف الإعلانات والـ Ad sets التي انخفض صرفها.",
      });
    }
  }

  // 6) هل الوتيرة تكفي للهدف؟ الميزانية ثابتة، فالمتغير هو سعر النتيجة
  if (!finished && p.target && p.daysLeft !== null && p.daysLeft > 0 && done.length >= 2) {
    const remaining = p.target - i.result;
    const perDayNow = recent.days ? recent.results / recent.days : 0;
    const need = remaining / p.daysLeft;
    const label = TYPE_AR[i.type];
    const k = i.type === "reach" ? " لكل 1000" : "";
    if (remaining > 0 && perDayNow < need * 0.95) {
      const unit = i.cpr ?? unitCpr(i.type, { spend: i.spend, results: i.result });
      const req = p.balance !== null && p.balance > 0
        ? (i.type === "reach" ? p.balance / (remaining / 1000) : p.balance / remaining) : null;
      if (req !== null && unit !== null && unit > req * 1.02) {
        const cut = pct((1 - req / unit) * 100);
        const trend = i.prevCpr && unit > i.prevCpr * 1.05
          ? `ارتفاع ${pct((unit / i.prevCpr - 1) * 100)}% عن الفترة السابقة (${money(i.prevCpr)}).`
          : rc3(recent, before, hasCompare, i.type) ;
        out.push({
          level: "bad",
          title: `سعر النتيجة ${money(unit)}${k}؛ المطلوب ${money(req)}${k} لتحقيق الهدف بالرصيد المتبقي`,
          cause: `المتبقي ${Math.round(remaining).toLocaleString("en-US")} ${label} خلال ${p.daysLeft} يوماً مع رصيد ${money(p.balance!)}. ${trend}`.trim(),
          action: `يجب أن تنخفض التكلفة بحوالي ${cut}% وإلا لن يتحقق الهدف.`,
        });
      } else {
        out.push({
          level: "warn",
          title: `الوتيرة ${Math.round(perDayNow).toLocaleString("en-US")} ${label} يومياً، والمطلوب ${Math.round(need).toLocaleString("en-US")}`,
          cause: `المتبقي ${Math.round(remaining).toLocaleString("en-US")} خلال ${p.daysLeft} يوماً؛ التكلفة جيدة لكن الصرف اليومي منخفض.`,
          action: "ارفع الصرف اليومي ليُستهلك الرصيد قبل نهاية الفترة.",
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
        level: "warn", title: `Ad set بلا نتائج يستهلك ${pct((dead[0].a.spend / totalSpend) * 100)}% من الصرف: ${LTR(dead[0].a.name)}`,
        cause: "صُرف عليه بلا نتائج حتى الآن.", action: "أوقفه أو انقل ميزانيته إلى أفضل Ad set.",
      });
    }
    const worst = withCpr.filter((x) => x.c !== null).sort((x, y) => y.c! - x.c!)[0];
    if (best && worst && worst.a.name !== best.a.name && worst.c! > best.c! * 1.5 && worst.a.spend / totalSpend >= 0.25) {
      out.push({
        level: "warn",
        title: `${LTR(worst.a.name)} تكلفته ${(worst.c! / best.c!).toFixed(1)} ضعف ${LTR(best.a.name)} ويستهلك ${pct((worst.a.spend / totalSpend) * 100)}% من الصرف`,
        cause: "جمهور أو تصميم أضعف.", action: `انقل جزءاً من ميزانيته إلى ${LTR(best.a.name)} أو أوقفه.`,
      });
    }
  }

  const order = { bad: 0, warn: 1, ok: 2 } as const;
  out.sort((a, b) => order[a.level] - order[b.level]);
  if (!out.length) {
    out.push({
      level: "ok",
      title: finished ? `تحقق الهدف${p.target ? ` (${Math.round((i.result / p.target) * 100)}%)` : ""} — التكلفة مستقرة` : p.target ? "لا مشاكل — الوتيرة جيدة" : "لا مشاكل في التسليم أو التكلفة",
      cause: "", action: finished ? "يمكنك إيقافها أو نقل ميزانيتها إلى حملة متأخرة." : p.target ? "" : "حدّد هدفاً لعرض التقدم.",
    });
  }
  return out.slice(0, 6);
}

// يُستخدم لحساب أيام الفترة المنقضية خارج هذا الملف إن لزم
export const daysBetween = diffDays;
