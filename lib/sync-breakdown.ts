import type { SupabaseClient } from "@supabase/supabase-js";
import { graphAll } from "./meta";
import { followsOf, leadsOf, resultFor, type CampaignType } from "./results";

export const DIMENSIONS = ["region", "age", "gender", "platform", "placement"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

// كل بُعد: breakdowns المطلوبة في Meta ودالة بناء المفتاح
const SPEC: Record<Dimension, { breakdowns: string; key: (r: any) => string | null }> = {
  region: { breakdowns: "region", key: (r) => r.region || null },
  age: { breakdowns: "age", key: (r) => r.age || null },
  gender: { breakdowns: "gender", key: (r) => r.gender || null },
  platform: { breakdowns: "publisher_platform", key: (r) => r.publisher_platform || null },
  placement: {
    breakdowns: "publisher_platform,platform_position",
    key: (r) => (r.publisher_platform ? `${r.publisher_platform} · ${r.platform_position || "—"}` : null),
  },
};

const FIELDS = "campaign_id,spend,impressions,clicks,reach,actions";
const FIELDS_VISIT = FIELDS + ",instagram_profile_visits";

/**
 * يجلب تفصيلات الفترة لكل الحملات والمجموعات. يتخطى إن كانت البيانات أحدث من 50 دقيقة.
 * تُعاد ملاحظة نصية فقط عند فشل جزئي.
 */
export async function syncBreakdowns(
  db: SupabaseClient,
  o: { act: string; clientId: string; from: string; to: string; campUuid: Map<string, { id: string; type: CampaignType }>; adsetUuid: Map<string, string> }
): Promise<string> {
  const ids = [...o.campUuid.values()].map((k) => k.id);
  if (!ids.length) return "";
  const { data: last } = await db.from("insights_breakdown").select("synced_at").in("entity_id", ids)
    .eq("date_from", o.from).order("synced_at", { ascending: false }).limit(1);
  if (last?.[0] && Date.now() - new Date(last[0].synced_at).getTime() < 50 * 60 * 1000) return "";

  const typeOfCamp = new Map<string, CampaignType>([...o.campUuid.values()].map((k) => [k.id, k.type]));
  const campById = new Map<string, { id: string; type: CampaignType }>([...o.campUuid.entries()].map(([m, v]) => [m, v]));
  const fails: string[] = [];
  const now = new Date().toISOString();

  const jobs: { dim: Dimension; level: "campaign" | "adset" }[] = [];
  for (const dim of DIMENSIONS) for (const level of ["campaign", "adset"] as const) jobs.push({ dim, level });
  const runJob = async ({ dim, level }: { dim: Dimension; level: "campaign" | "adset" }) => {
    {
      const spec = SPEC[dim];
      const fetchRows = async (fields: string) =>
        graphAll<any>(`${o.act}/insights`, {
          level, fields: level === "adset" ? "adset_id," + fields : fields,
          breakdowns: spec.breakdowns, time_range: JSON.stringify({ since: o.from, until: o.to }),
        }, 30);
      let rows: any[];
      try {
        rows = await fetchRows(FIELDS_VISIT);
      } catch {
        try { rows = await fetchRows(FIELDS); } catch (e: any) { fails.push(`${dim}/${level}: ${e?.message || ""}`.slice(0, 120)); return; }
      }
      // تجميع الصفوف المتكررة بنفس المفتاح (احتياط)
      const agg = new Map<string, any>();
      for (const r of rows) {
        const k = campById.get(r.campaign_id);
        const key = spec.key(r);
        if (!k || !key) continue;
        const entity = level === "campaign" ? k.id : o.adsetUuid.get(r.adset_id);
        if (!entity) continue;
        const id = entity + "|" + key;
        const cur = agg.get(id) || {
          level, entity_id: entity, date_from: o.from, date_to: o.to, dimension: dim, key,
          spend: 0, impressions: 0, clicks: 0, reach: 0, results: 0, leads: 0, follows: 0, synced_at: now,
        };
        cur.spend += Number(r.spend) || 0;
        cur.impressions += Number(r.impressions) || 0;
        cur.clicks += Number(r.clicks) || 0;
        cur.reach += Number(r.reach) || 0;
        cur.results += resultFor(typeOfCamp.get(k.id) || k.type, r);
        cur.follows += followsOf(r);
        cur.leads += leadsOf(r); // Meta leads الحقيقية (Lead)
        agg.set(id, cur);
      }
      const out = [...agg.values()];
      // upsert فقط (لا حذف قبل الإدراج): فشل الجلب أو الكتابة لا يمحو البيانات السابقة
      for (let i = 0; i < out.length; i += 500) {
        const { error } = await db.from("insights_breakdown").upsert(out.slice(i, i + 500), { onConflict: "level,entity_id,date_from,date_to,dimension,key" });
        if (error) { fails.push(`${dim}/${level}: ${error.message}`.slice(0, 120)); break; }
      }
    }
  };
  // 4 مهام بالتوازي كحد أقصى
  for (let i = 0; i < jobs.length; i += 4) await Promise.all(jobs.slice(i, i + 4).map(runJob));
  return fails.length ? "breakdown: " + fails.join("; ") : "";
}
