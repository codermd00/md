// Results per Instagram post: ads are named with the post code (the part after /p/ in the post link),
// so ad-level insights are grouped by that code. The goal comes from the campaign the ad sits in.
import { graphAll } from "./meta";
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
  ads: number; spend: number; result: number; visits: number; follows: number; reach: number; impressions: number;
};

type AdRow = { ad_id: string; ad_name: string; campaign_id: string; spend?: string; impressions?: string; reach?: string; instagram_profile_visits?: string };

export async function pullPostResults(
  act: string, from: string, to: string,
  campTypes: Map<string, CampaignType>, knownCodes: Set<string>,
): Promise<Agg[]> {
  const time_range = JSON.stringify({ since: from, until: to });
  const rows = await graphAll<any>(`act_${act}/insights`, {
    level: "ad", time_range,
    fields: "campaign_id,campaign_name,ad_id,ad_name,spend,impressions,reach,actions,instagram_profile_visits,video_thruplay_watched_actions",
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

  const out = new Map<string, Agg>();
  for (const r of rows as AdRow[]) {
    const spend = Number(r.spend) || 0;
    if (spend <= 0) continue;
    const name = String(r.ad_name || "");
    const type = campTypes.get(String(r.campaign_id)) || "other";
    const dark = /dark/i.test(name);
    const code = dark ? null : codeOf(name, knownCodes);
    const base = dark ? "dark:" + name.trim().toLowerCase() : code || "name:" + name.trim();
    const key = base + "|" + type;
    const a = out.get(key) || { key, code, name: dark || !code ? name.trim() : code, dark, type, goal: dark ? "sales" : goalOfType(type), ads: 0, spend: 0, result: 0, visits: 0, follows: 0, reach: 0, impressions: 0 } as Agg;
    a.ads += 1; a.spend += spend; a.result += resultFor(type, r as any);
    a.visits += Number(r.instagram_profile_visits) || 0; a.follows += follows.get(String(r.ad_id)) || 0;
    a.reach += Number(r.reach) || 0; a.impressions += Number(r.impressions) || 0;
    out.set(key, a);
  }
  return [...out.values()].sort((x, y) => y.spend - x.spend);
}

/** Key used to store typed orders for a row (the same post in other goals shares it) */
export const ordersKey = (a: { key: string }) => a.key.split("|")[0];
