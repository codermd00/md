export type CampaignType = "messages" | "reach" | "visit" | "engagement" | "other";

/** نوع الحملة يُكتشف من optimization_goal للمجموعات — لا من الاسم */
export function typeFromGoal(goal?: string | null): CampaignType {
  const g = (goal || "").toUpperCase();
  if (g === "CONVERSATIONS" || g === "MESSAGING_PURCHASE_CONVERSION" || g === "MESSAGING_APPOINTMENT_CONVERSION") return "messages";
  if (g === "REACH" || g === "IMPRESSIONS" || g === "AD_RECALL_LIFT") return "reach";
  if (g === "VISIT_INSTAGRAM_PROFILE" || g === "PROFILE_VISIT" || g === "INSTAGRAM_PROFILE_VISIT") return "visit";
  if (g === "POST_ENGAGEMENT" || g === "ENGAGED_USERS" || g === "PAGE_LIKES") return "engagement";
  return "other";
}

type Row = { actions?: { action_type: string; value: string }[]; reach?: string; instagram_profile_visits?: string };

const pick = (row: Row, types: string[]) => {
  for (const t of types) {
    const a = row.actions?.find((x) => x.action_type === t);
    if (a) return Number(a.value) || 0;
  }
  return 0;
};

/** نتيجة صف إحصائيات حسب نوع الحملة (رقم واحد بنوعه، لا يُجمع مع نوع آخر) */
export function resultFor(type: CampaignType, row: Row): number {
  switch (type) {
    case "messages":
      return pick(row, ["onsite_conversion.messaging_conversation_started_7d"]);
    case "reach":
      return Number(row.reach) || 0;
    case "visit": {
      // حقل مستقل في Insights (ليس ضمن actions)
      const direct = Number(row.instagram_profile_visits);
      if (direct) return direct;
      const exact = pick(row, ["instagram_profile_visits", "instagram_profile_visit", "profile_visit", "profile_visits"]);
      if (exact) return exact;
      // احتياط: أي action_type يحتوي profile_visit
      const fuzzy = row.actions?.find((x) => /profile[_ ]?visit/i.test(x.action_type));
      return fuzzy ? Number(fuzzy.value) || 0 : 0;
    }
    case "engagement":
      return pick(row, ["post_engagement"]);
    default:
      return 0;
  }
}

export const TYPE_LABEL: Record<CampaignType, string> = {
  messages: "Messages", reach: "Reach", visit: "Visit", engagement: "Engagement", other: "Other",
};

/** تكلفة النتيجة بصيغة Ads Manager: Reach لكل 1000 شخص، والباقي لكل نتيجة (3 خانات إذا أقل من 0.01) */
export function formatCpr(type: CampaignType, spend: number, results: number): string {
  if (!results || results <= 0 || type === "other") return "—";
  if (type === "reach") return "$" + ((spend / results) * 1000).toFixed(2) + " /1K";
  const v = spend / results;
  return "$" + (v < 0.01 ? v.toFixed(3) : v.toFixed(2));
}

/** قيمة CPR رقمية (للرسم والمقارنة): Reach لكل 1000 */
export function cprValue(type: CampaignType, spend: number, results: number): number | null {
  if (!results || results <= 0 || type === "other") return null;
  return type === "reach" ? (spend / results) * 1000 : spend / results;
}

/**
 * Meta leads: نتيجة Lead التي تسجّلها Meta نفسها — نماذج العملاء، وكذلك العملاء المحتملون
 * الذين تكتشفهم Meta داخل المحادثات (رسائل). لا تُجمع أنواعها معاً (تفادي العدّ المزدوج):
 * نأخذ النوع المعروف أولاً، وإلا أكبر قيمة بين أي action_type يحوي "lead".
 */
export function leadsOf(row: Row): number {
  const known = pick(row, ["onsite_conversion.lead_grouped", "lead", "onsite_conversion.messaging_lead", "offsite_conversion.fb_pixel_lead"]);
  if (known) return known;
  const any = (row.actions || []).filter((a) => /lead/i.test(a.action_type)).map((a) => Number(a.value) || 0);
  return any.length ? Math.max(...any) : 0;
}
