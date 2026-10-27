// Results per Instagram post: ads are named with the post code (the part after /p/ in the post link),
// so ad-level insights are grouped by that code. The goal comes from the campaign the ad sits in.
import { graph, graphAll } from "./meta";
import { followsOf, resultFor, type CampaignType } from "./results";

export type Goal = "sales" | "followers" | "awareness" | "other";

export const goalOfType = (t: CampaignType): Goal =>
  t === "messages" || t === "leads" ? "sales" : t === "visit" ? "followers" : t === "reach" || t === "engagement" || t === "thruplay" ? "awareness" : "other";

/** Post code at the start of an ad name ("DexKvnIxy_a", "DexKvnIxy_a - Copy"). Known post codes win; otherwise an 11-char mixed-case token. */
export function codeOf(adName: string, known: Set<string>): string | null {
  const m = adName.trim().match(/^([A-Za-z0-9_-]{6,12})(?![A-Za-z0-9_-])/);
  if (!m) return null;
  const t = m[1];
  if (known.has(t)) return t;
  return t.length === 11 && /[A-Z]/.test(t) && /[a-z]/.test(t) ? t : null;
}

export type Agg = {
  key: string; code: string | null; name: string; dark: boolean; type: CampaignType; goal: Goal;
  ads: number; spend: number; result: number; visits: number; follows: number; reach: number; impressions: number; clicks: number; clicksAll: number; thumb: string; active: boolean; adList: { id: string; adset: string; active: boolean }[];
};

/** Ad creative thumbnails (best effort): ad id -> image url. Used when the post is not saved in Content Manager. */
async function adInfo(adIds: string[]): Promise<{ thumbs: Map<string, string>; active: Set<string> }> {
  const out = new Map<string, string>();
  const active = new Set<string>();
  try {
    const uniq = [...new Set(adIds)];
    const creativeOf = new Map<string, string>();
    for (let i = 0; i < uniq.length; i += 50) {
      const r = await graph<Record<string, any>>("", { ids: uniq.slice(i, i + 50).join(","), fields: "creative{id},effective_status" });
      for (const [adId, v] of Object.entries(r)) {
        if (v?.creative?.id) creativeOf.set(adId, String(v.creative.id));
        if (v?.effective_status === "ACTIVE") active.add(adId);
      }
    }
    const cids = [...new Set(creativeOf.values())];
    const urlOf = new Map<string, string>();
    for (let i = 0; i < cids.length; i += 50) {
      const r = await graph<Record<string, any>>("", { ids: cids.slice(i, i + 50).join(","), fields: "thumbnail_url", thumbnail_width: 200, thumbnail_height: 200 });
      for (const [cid, v] of Object.entries(r)) if (v?.thumbnail_url) urlOf.set(cid, String(v.thumbnail_url));
    }
    for (const [adId, cid] of creativeOf) { const u = urlOf.get(cid); if (u) out.set(adId, u); }
  } catch { /* thumbnails and status are optional */ }
  return { thumbs: out, active };
}

type AdRow = { adset_name?: string; ad_id: string; ad_name: string; campaign_id: string; spend?: string; impressions?: string; reach?: string; instagram_profile_visits?: string; inline_link_clicks?: string; clicks?: string };

export async function pullPostResults(
  act: string, from: string, to: string,
  campTypes: Map<string, CampaignType>, knownCodes: Set<string>,
): Promise<Agg[]> {
  const time_range = JSON.stringify({ since: from, until: to });
  const rows = await graphAll<any>(`act_${act}/insights`, {
    level: "ad", time_range,
    fields: "campaign_id,campaign_name,adset_name,ad_id,ad_name,spend,impressions,reach,actions,instagram_profile_visits,inline_link_clicks,clicks,video_thruplay_watched_actions",
  }, 30);

  // follows are a separate field and need the same attribution setup as Ads Manager (best effort)
  const follows = new Map<string, number>();
  try {
    const fr = await graphAll<any>(`act_${act}/insights`, {
      level: "ad", time_range, fields: "ad_id,instagram_profile_follow",
      use_unified_attribution_setting: "true", action_attribution_windows: JSON.stringify(["1d_click", "7d_click", "1d_view"]),
    }, 30);
    for (const r of fr) follows.set(String(r.ad_id), (follows.get(String(r.ad_id)) || 0) + followsOf(r));
  } catch { /* optional */ }

  const { thumbs, active } = await adInfo((rows as AdRow[]).filter((r) => Number(r.spend) > 0).map((r) => String(r.ad_id)));
  const out = new Map<string, Agg>();
  for (const r of rows as AdRow[]) {
    const spend = Number(r.spend) || 0;
    if (spend <= 0) continue;
    const name = String(r.ad_name || "");
    const type = campTypes.get(String(r.campaign_id)) || "other";
    const dark = /dark/i.test(name);
    const code = dark ? null : codeOf(name, knownCodes);
    const base = dark ? "dark:" + name.trim().toLowerCase() : code || "name:" + name.trim().toLowerCase();
    const key = base + "|" + type;
    const a = out.get(key) || { key, code, name: dark || !code ? name.trim() : code, dark, type, goal: dark ? "sales" : goalOfType(type), ads: 0, spend: 0, result: 0, visits: 0, follows: 0, reach: 0, impressions: 0, clicks: 0, clicksAll: 0, thumb: "", active: false, adList: [] } as Agg;
    const isActive = active.has(String(r.ad_id));
    if (isActive) a.active = true;
    a.adList.push({ id: String(r.ad_id), adset: String(r.adset_name || ""), active: isActive });
    if (!a.thumb) a.thumb = thumbs.get(String(r.ad_id)) || "";
    a.ads += 1; a.spend += spend; a.result += resultFor(type, r as any);
    a.visits += Number(r.instagram_profile_visits) || 0; a.follows += follows.get(String(r.ad_id)) || 0;
    a.reach += Number(r.reach) || 0; a.impressions += Number(r.impressions) || 0;
    a.clicks += Number(r.inline_link_clicks) || 0; a.clicksAll += Number(r.clicks) || 0;
    out.set(key, a);
  }
  return [...out.values()].sort((x, y) => y.spend - x.spend);
}

/** Key used to store typed orders for a row (the same post in other goals shares it) */
export const ordersKey = (a: { key: string }) => a.key.split("|")[0];
