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
const TYPE_AR: Record<CampaignType, string> = { messages: "الرسائل", reach: "الوصول", visit: "الزيارات", engagement: "التفاعل", other: "النتائج" };

function rc3(recent: Agg, before: Agg, ok: boolean, type: CampaignType): string {
  if (!ok) return "";
  const r = unitCpr(type, recent), b = unitCpr(type, before);
  return r !== null && b !== null && r > b * 1.1 ? `ارتفع ${pct((r / b - 1) * 100)}% في آخر ${recent.days} أيام.` : "";
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
      level: "bad", title: `الحملة غير نشطة (${i.effectiveStatus})`,
      cause: "الصرف متوقف، فلا تُنتج الحملة نتائج.",
      action: "فعّل الحملة أو راجع سبب الإيقاف إن لم يكن مقصوداً.",
    });
  } else if (done.length >= 2 && done.slice(-2).every((d) => d.spend === 0)) {
    out.push({
      level: "bad", title: "لم تصرف منذ يومين رغم أنها نشطة",
      cause: "غالباً مجموعة بلا تسليم: إعلان قيد المراجعة أو مرفوض، أو مشكلة دفع، أو جمهور ضيق جداً.",
      action: "افتح Ads Manager ← Delivery وراجع حالة المجموعات والإعلانات.",
    });
  }
  const sick = i.adsets.filter((a) => ["WITH_ISSUES", "DISAPPROVED", "PENDING_REVIEW", "IN_PROCESS"].includes(a.effectiveStatus));
  if (sick.length) {
    out.push({
      level: sick.some((a) => ["WITH_ISSUES", "DISAPPROVED"].includes(a.effectiveStatus)) ? "bad" : "warn",
      title: `مجموعات بها مشكلة: ${sick.map((a) => `${a.name} (${a.effectiveStatus})`).join("، ")}`,
      cause: "إعلان مرفوض أو قيد المراجعة يمنع التسليم الكامل.",
      action: "راجع الإعلانات داخل المجموعة وعدّل المرفوض أو استبدله.",
    });
  }

  // 2) مشكلة الصرف (التسليم أقل من المخطط)
  if (i.goalBudget && p.total > 0 && p.elapsed >= 2 && i.effectiveStatus === "ACTIVE") {
    const planned = (i.goalBudget * Math.min(p.elapsed, p.total)) / p.total;
    if (planned > 0 && i.spend < planned * 0.85) {
      const share = (i.spend / planned) * 100;
      out.push({
        level: share < 60 ? "bad" : "warn",
        title: `الصرف ${pct(share)}% من المخطط حتى اليوم (${money(i.spend)} من ${money(planned)})`,
        cause: "ميزانية المجموعات منخفضة، أو جمهور ضيق، أو التعلّم محدود، أو مزايدة منخفضة.",
        action: "ارفع ميزانية المجموعات الناجحة أو وسّع الجمهور.",
      });
    } else if (i.goalBudget && i.spend > i.goalBudget) {
      out.push({
        level: "warn", title: `الصرف تجاوز ميزانية الحملة (${money(i.spend)} من ${money(i.goalBudget)})`,
        cause: "ميزانيات المجموعات أعلى من ميزانية الحملة المحددة هنا.",
        action: "خفّض ميزانيات المجموعات أو حدّث ميزانية الحملة في Edit.",
      });
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
      let cause = "لا مكوّن واحد واضح؛ ارتفاع طفيف في أكثر من عامل.";
      let action = "راقب يومين قبل التغيير.";
      if (top && top.r >= 1.15) {
        if (top.k === "cpm") {
          cause = `تكلفة الظهور CPM ارتفعت ${pct((top.r - 1) * 100)}%: منافسة أعلى أو جمهور أضيق أو موسم.`;
          action = "وسّع الجمهور أو فعّل Advantage+ placements، وجرّب جمهوراً جديداً.";
        } else if (top.k === "ctr") {
          cause = `نسبة النقر CTR انخفضت ${pct((top.r - 1) * 100)}%: الإعلان لم يعد يجذب (تعب إعلاني أو هوك ضعيف).`;
          action = "بدّل الصورة/الفيديو أو الهوك وأضف إعلاناً جديداً.";
        } else {
          cause = `النقرات لا تتحول إلى نتائج (التحويل هبط ${pct((top.r - 1) * 100)}%): العرض أو تجربة ما بعد النقر أو سرعة الرد.`;
          action = i.type === "messages" ? "راجع رسالة الترحيب وسرعة الرد والعرض." : "راجع وجهة الإعلان وما يراه المستخدم بعد النقر.";
        }
      }
      if (finished) {
        out.push({
          level: "warn", title: `الهدف تحقق، لكن التكلفة ارتفعت ${worse}% في آخر ${recent.days} أيام (${money(rc)} مقابل ${money(bc)}${i.type === "reach" ? " لكل 1000" : ""})`,
          cause, action: `${action} ${p.balance && p.balance > 0 ? `لتحصل على أقصى استفادة من الرصيد المتبقي ${money(p.balance)}: أصلح السبب، أو انقل جزءاً منه إلى حملة متأخرة، أو أوقف الحملة.` : ""}`.trim(),
        });
      } else
      out.push({ level: "bad", title: `تكلفة النتيجة ارتفعت ${worse}% في آخر ${recent.days} أيام (${money(rc)} مقابل ${money(bc)}${i.type === "reach" ? " لكل 1000" : ""})`, cause, action });
    }
  }
  if (i.cpr !== null && i.prevCpr && i.cpr > i.prevCpr * 1.2) {
    out.push({
      level: "warn", title: `التكلفة أعلى من الفترة السابقة بـ ${pct((i.cpr / i.prevCpr - 1) * 100)}%`,
      cause: "ظروف المزاد أو الجمهور أو الإعلانات تغيّرت عن الفترة السابقة.",
      action: "قارن الإعلانات والجمهور بين الفترتين وأعد ما نجح سابقاً.",
    });
  }

  // 4) التعب الإعلاني
  if (!finished && i.frequency !== null && i.type !== "reach") {
    const ctrDrop = hasCompare && ctr(recent) && ctr(before) ? (ctr(before)! / ctr(recent)!) : 1;
    if (i.frequency >= 2.5 && ctrDrop >= 1.15) {
      out.push({
        level: "bad", title: `تعب إعلاني: التكرار ${i.frequency.toFixed(1)} مع هبوط CTR`,
        cause: "الجمهور رأى الإعلان مراراً فتراجع التفاعل.",
        action: "ضع محتوى جديداً أو وسّع الجمهور لتقليل التكرار.",
      });
    } else if (i.frequency >= 3.5) {
      out.push({
        level: "warn", title: `التكرار مرتفع (${i.frequency.toFixed(1)})`,
        cause: "الجمهور يقترب من التشبع.", action: "جهّز محتوى بديلاً قبل أن تهبط النتائج.",
      });
    }
  } else if (i.frequency !== null && i.type === "reach" && i.frequency >= 4) {
    out.push({
      level: "warn", title: `التكرار ${i.frequency.toFixed(1)} في حملة وصول`,
      cause: "نفس الأشخاص يتكرر وصولهم فيقل الوصول الجديد.", action: "وسّع الجمهور أو قلّل الميزانية اليومية.",
    });
  }

  // 5) اتجاه النتائج
  if (!finished && hasCompare) {
    const rPer = recent.results / recent.days, bPer = before.results / before.days;
    if (bPer > 0 && rPer < bPer * 0.75) {
      out.push({
        level: "warn", title: `النتائج اليومية تراجعت ${pct((1 - rPer / bPer) * 100)}% (${rPer.toFixed(1)} مقابل ${bPer.toFixed(1)} يومياً)`,
        cause: "تراجع في التسليم أو الجذب أو تأثير التعب الإعلاني.",
        action: "راجع الإعلانات الأضعف والمجموعات التي هبط صرفها.",
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
          ? `ارتفع ${pct((unit / i.prevCpr - 1) * 100)}% عن الفترة السابقة (${money(i.prevCpr)}).`
          : rc3(recent, before, hasCompare, i.type) ;
        out.push({
          level: "bad",
          title: `السعر ارتفع: تكلفة النتيجة ${money(unit)}${k} والمطلوب ${money(req)}${k} للوصول إلى الهدف بالميزانية المتبقية`,
          cause: `بقي ${Math.round(remaining).toLocaleString("en-US")} من ${label} خلال ${p.daysLeft} يوم برصيد ${money(p.balance!)}. ${trend}`.trim(),
          action: `يجب خفض التكلفة ≈ ${cut}% (انظر سبب الارتفاع أعلاه: الجمهور/الإعلان/الرد) وإلا لن يتحقق الهدف.`,
        });
      } else {
        out.push({
          level: "warn",
          title: `الوتيرة ${Math.round(perDayNow).toLocaleString("en-US")} ${label}/يوم والمطلوب ${Math.round(need).toLocaleString("en-US")}`,
          cause: `بقي ${Math.round(remaining).toLocaleString("en-US")} خلال ${p.daysLeft} يوم، والتكلفة الحالية تكفي لكن الصرف اليومي أقل من اللازم.`,
          action: "وزّع الرصيد المتبقي على الأيام المتبقية بحيث يُصرف كاملاً قبل نهاية الفترة (ارفع الصرف اليومي ضمن الرصيد).",
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
        level: "warn", title: `مجموعة بلا نتائج تستهلك ${pct((dead[0].a.spend / totalSpend) * 100)}% من الصرف: ${dead[0].a.name}`,
        cause: "صرفت دون أي نتيجة حتى الآن.", action: "أوقفها أو انقل ميزانيتها إلى المجموعة الأفضل.",
      });
    }
    const worst = withCpr.filter((x) => x.c !== null).sort((x, y) => y.c! - x.c!)[0];
    if (best && worst && worst.a.name !== best.a.name && worst.c! > best.c! * 1.5 && worst.a.spend / totalSpend >= 0.25) {
      out.push({
        level: "warn",
        title: `المجموعة ${worst.a.name} أغلى ${(worst.c! / best.c!).toFixed(1)}× من ${best.a.name} وتستهلك ${pct((worst.a.spend / totalSpend) * 100)}% من الصرف`,
        cause: "جمهور أو إعلان أضعف داخل الحملة.", action: `انقل جزءاً من ميزانيتها إلى ${best.a.name} أو أوقفها.`,
      });
    }
  }

  const order = { bad: 0, warn: 1, ok: 2 } as const;
  out.sort((a, b) => order[a.level] - order[b.level]);
  if (!out.length) {
    out.push({
      level: "ok",
      title: finished ? `الهدف تحقق${p.target ? ` (${Math.round((i.result / p.target) * 100)}%)` : ""} — والتكلفة مستقرة` : p.target ? "لا مشاكل ظاهرة — الحملة تسير بالوتيرة المطلوبة" : "لا مشاكل ظاهرة في التسليم أو التكلفة",
      cause: "", action: finished ? "إن لم تحتج مزيداً يمكنك إيقاف الحملة أو نقل ميزانيتها لحملة متأخرة." : p.target ? "" : "حدّد هدفاً لتظهر مقارنة التقدم.",
    });
  }
  return out.slice(0, 6);
}

// يُستخدم لحساب أيام الفترة المنقضية خارج هذا الملف إن لزم
export const daysBetween = diffDays;
