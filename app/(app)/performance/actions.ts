"use server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { graphAll } from "@/lib/meta";
import { SPEC, DIMENSIONS } from "@/lib/sync-breakdown";
import { leadsOf, resultFor, type CampaignType } from "@/lib/results";

export async function saveGoal(input: {
  campaignId: string; periodStart: string; budget: string; target: string;
}): Promise<{ ok: boolean; message: string }> {
  const sb = createServerSupabase();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return { ok: false, message: "Unauthorized" };
  const budget = input.budget.trim() === "" ? null : Number(input.budget);
  const target = input.target.trim() === "" ? null : Number(input.target);
  if ((budget !== null && !(budget >= 0)) || (target !== null && !(target >= 0)))
    return { ok: false, message: "Invalid numbers" };
  const { error } = await sb.from("campaign_goals").upsert(
    {
      campaign_id: input.campaignId, period_start: input.periodStart, budget, target,
      source: "manual", updated_at: new Date().toISOString(),
    },
    { onConflict: "campaign_id,period_start" }
  );
  if (error) return { ok: false, message: error.message };
  revalidatePath("/performance");
  return { ok: true, message: "Saved" };
}

export type RangeStat = { id: string; spend: number; results: number; impressions: number; clicks: number; reach: number; leads: number; follows: number };
export type RangeRow = { entityId: string; dimension: string; key: string; spend: number; impressions: number; clicks: number; reach: number; results: number; leads: number; follows: number };
export type RangeResult = { ok: boolean; message: string; stats: RangeStat[]; rows: RangeRow[] };

const RANGE_FIELDS = "spend,impressions,clicks,reach,actions,instagram_profile_visits,video_thruplay_watched_actions";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Temporary, live numbers from Meta for one campaign / ad set over a custom day range. Nothing is saved. */
export async function rangeBreakdown(entityId: string, from: string, to: string): Promise<RangeResult> {
  const fail = (message: string): RangeResult => ({ ok: false, message, stats: [], rows: [] });
  const sb = createServerSupabase();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return fail("Unauthorized");
  if (!DAY.test(from) || !DAY.test(to) || from > to) return fail("Invalid dates");

  let level: "campaign" | "adset" = "campaign";
  let meta = "", clientId = "", type: CampaignType = "other";
  const { data: camp } = await sb.from("campaigns").select("meta_id,type,client_id").eq("id", entityId).maybeSingle();
  if (camp) { meta = camp.meta_id; clientId = camp.client_id; type = camp.type; }
  else {
    const { data: a } = await sb.from("ad_sets").select("meta_id,client_id,campaign_id").eq("id", entityId).maybeSingle();
    if (!a) return fail("Not found");
    const { data: parent } = await sb.from("campaigns").select("type").eq("id", a.campaign_id).maybeSingle();
    level = "adset"; meta = a.meta_id; clientId = a.client_id; type = (parent?.type as CampaignType) || "other";
  }
  const { data: client } = await sb.from("clients").select("ad_account_id").eq("id", clientId).maybeSingle();
  if (!client) return fail("Client not found");
  const act = `act_${client.ad_account_id}`;
  const base = {
    time_range: JSON.stringify({ since: from, until: to }),
    filtering: JSON.stringify([{ field: level === "campaign" ? "campaign.id" : "adset.id", operator: "IN", value: [meta] }]),
  };

  // uuid map for the ad sets of this campaign
  const setUuid = new Map<string, string>();
  if (level === "campaign") {
    const { data: sets } = await sb.from("ad_sets").select("id,meta_id").eq("campaign_id", entityId);
    for (const x of (sets || []) as any[]) setUuid.set(x.meta_id, x.id);
  }
  const stats = new Map<string, RangeStat>();
  const blank = (id: string): RangeStat => ({ id, spend: 0, results: 0, impressions: 0, clicks: 0, reach: 0, leads: 0, follows: 0 });
  const errs: string[] = [];

  try {
    const levels: ("campaign" | "adset")[] = level === "campaign" ? ["campaign", "adset"] : ["adset"];
    await Promise.all(levels.map(async (lv) => {
      const rows = await graphAll<any>(`${act}/insights`, { ...base, level: lv, fields: (lv === "adset" ? "adset_id," : "campaign_id,") + RANGE_FIELDS }, 20);
      for (const r of rows) {
        const id = lv === "campaign" ? entityId : lv === "adset" && level === "adset" ? entityId : setUuid.get(r.adset_id);
        if (!id) continue;
        const st = stats.get(id) || blank(id);
        st.spend += Number(r.spend) || 0; st.impressions += Number(r.impressions) || 0; st.clicks += Number(r.clicks) || 0; st.reach += Number(r.reach) || 0;
        st.results += resultFor(type, r); st.leads += leadsOf(r);
        stats.set(id, st);
      }
    }));
  } catch (e: any) { return fail((e?.message || "Meta request failed").slice(0, 200)); }

  // follows (best effort)
  try {
    for (const lv of (level === "campaign" ? ["campaign", "adset"] : ["adset"]) as ("campaign" | "adset")[]) {
      const fr = await graphAll<any>(`${act}/insights`, {
        ...base, level: lv, fields: lv === "adset" ? "adset_id,instagram_profile_follow" : "campaign_id,instagram_profile_follow",
        use_unified_attribution_setting: "true", action_attribution_windows: JSON.stringify(["1d_click", "7d_click", "1d_view"]),
      }, 20);
      for (const r of fr) {
        const id = lv === "campaign" ? entityId : level === "adset" ? entityId : setUuid.get(r.adset_id);
        const st = id && stats.get(id);
        if (st) st.follows += Number(r.instagram_profile_follow) || 0;
      }
    }
  } catch { /* optional */ }

  // dimension tabs for the selected entity
  const rows: RangeRow[] = [];
  await Promise.all(DIMENSIONS.map(async (dim) => {
    try {
      const spec = SPEC[dim];
      const data = await graphAll<any>(`${act}/insights`, { ...base, level, fields: RANGE_FIELDS, breakdowns: spec.breakdowns }, 30);
      const agg = new Map<string, RangeRow>();
      for (const r of data) {
        const key = spec.key(r);
        if (!key) continue;
        const cur = agg.get(key) || { entityId, dimension: dim, key, spend: 0, impressions: 0, clicks: 0, reach: 0, results: 0, leads: 0, follows: 0 };
        cur.spend += Number(r.spend) || 0; cur.impressions += Number(r.impressions) || 0; cur.clicks += Number(r.clicks) || 0;
        cur.reach += Number(r.reach) || 0; cur.results += resultFor(type, r); cur.leads += leadsOf(r);
        agg.set(key, cur);
      }
      rows.push(...agg.values());
    } catch (e: any) { errs.push(dim); }
  }));
  return { ok: true, message: errs.length ? "Some tabs failed: " + errs.join(", ") : "", stats: [...stats.values()], rows };
}

/** Delete one archived period of a client (ranges, breakdowns, goals). Daily rows and the current period are untouched. */
export async function deletePeriod(clientId: string, from: string): Promise<{ ok: boolean; message: string }> {
  const sb = createServerSupabase();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return { ok: false, message: "Unauthorized" };
  if (!DAY.test(from)) return { ok: false, message: "Invalid date" };
  const { data: c } = await sb.from("clients").select("id,period_start").eq("id", clientId).maybeSingle();
  if (!c) return { ok: false, message: "Client not found" };
  if (c.period_start === from) return { ok: false, message: "This is the current period" };
  const { data: camps } = await sb.from("campaigns").select("id").eq("client_id", clientId);
  const { data: sets } = await sb.from("ad_sets").select("id").eq("client_id", clientId);
  const campIds = (camps || []).map((x: any) => x.id);
  const ids = [clientId, ...campIds, ...(sets || []).map((x: any) => x.id)];
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    const a = await sb.from("insights_range").delete().eq("date_from", from).in("entity_id", part);
    if (a.error) return { ok: false, message: a.error.message };
    const b = await sb.from("insights_breakdown").delete().eq("date_from", from).in("entity_id", part);
    if (b.error) return { ok: false, message: b.error.message };
  }
  if (campIds.length) {
    const g = await sb.from("campaign_goals").delete().eq("period_start", from).in("campaign_id", campIds);
    if (g.error) return { ok: false, message: g.error.message };
  }
  revalidatePath("/performance");
  return { ok: true, message: "Deleted" };
}
