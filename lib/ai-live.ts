// Live day-by-day numbers per ad set and per ad, fetched from Meta only when the AI is asked (nothing is saved).
import { graphAll } from "./meta";
import { cprValue, resultFor, type CampaignType } from "./results";

const FIELDS = "spend,reach,actions,instagram_profile_visits";
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

type Agg = { spend: number; results: number };
type Node = { id: string; name: string; adsetId: string; camp: string; daily: Map<string, Agg>; total: Agg; prev: Agg | null };

async function pull(act: string, level: "adset" | "ad", range: { from: string; to: string }, daily: boolean) {
  const ids = level === "adset" ? "campaign_id,adset_id,adset_name," : "campaign_id,adset_id,adset_name,ad_id,ad_name,";
  return graphAll<any>(`act_${act}/insights`, {
    level, fields: ids + FIELDS, time_range: JSON.stringify({ since: range.from, until: range.to }), ...(daily ? { time_increment: 1 } : {}),
  }, 20);
}

export async function liveBreakdown(
  act: string, cur: { from: string; to: string }, prev: { from: string; to: string } | null,
  camps: { meta_id: string; name: string; type: CampaignType }[],
): Promise<any> {
  const typeOf = new Map(camps.map((k) => [k.meta_id, k]));
  const safe = async (p: Promise<any[]>) => { try { return await p; } catch { return null; } };
  const [setDaily, adDaily, setTot, adTot, setPrev, adPrev] = await Promise.all([
    safe(pull(act, "adset", cur, true)), safe(pull(act, "ad", cur, true)),
    safe(pull(act, "adset", cur, false)), safe(pull(act, "ad", cur, false)),
    prev ? safe(pull(act, "adset", prev, false)) : Promise.resolve(null),
    prev ? safe(pull(act, "ad", prev, false)) : Promise.resolve(null),
  ]);
  if (!setDaily && !adDaily) return { note: "Live daily data could not be loaded from Meta" };

  const build = (level: "adset" | "ad", daily: any[] | null, tot: any[] | null, pv: any[] | null) => {
    const nodes = new Map<string, Node>();
    const key = (r: any) => String(level === "adset" ? r.adset_id : r.ad_id);
    const res = (r: any) => resultFor(typeOf.get(String(r.campaign_id))?.type || "other", r);
    for (const r of daily || []) {
      const k = key(r); if (!k || !typeOf.has(String(r.campaign_id))) continue;
      const n = nodes.get(k) || { id: k, name: level === "adset" ? r.adset_name : r.ad_name, adsetId: String(r.adset_id), camp: String(r.campaign_id), daily: new Map(), total: { spend: 0, results: 0 }, prev: null };
      const d = n.daily.get(r.date_start) || { spend: 0, results: 0 };
      d.spend += Number(r.spend) || 0; d.results += res(r); n.daily.set(r.date_start, d);
      nodes.set(k, n);
    }
    // period totals from a non-daily call (correct for reach); fall back to summing the days
    for (const n of nodes.values()) for (const d of n.daily.values()) { n.total.spend += d.spend; n.total.results += d.results; }
    for (const r of tot || []) { const n = nodes.get(key(r)); if (n) n.total = { spend: Number(r.spend) || 0, results: res(r) }; }
    for (const r of pv || []) { const n = nodes.get(key(r)); if (n) n.prev = { spend: Number(r.spend) || 0, results: res(r) }; }
    return nodes;
  };
  const sets = build("adset", setDaily, setTot, setPrev);
  const ads = build("ad", adDaily, adTot, adPrev);

  const fmt = (n: Node) => {
    const t = typeOf.get(n.camp)!.type;
    return {
      name: n.name,
      spend: r2(n.total.spend), results: Math.round(n.total.results), cost: (() => { const c = cprValue(t, n.total.spend, n.total.results); return c === null ? null : r3(c); })(),
      prevPeriod: n.prev ? { spend: r2(n.prev.spend), results: Math.round(n.prev.results), cost: (() => { const c = cprValue(t, n.prev!.spend, n.prev!.results); return c === null ? null : r3(c); })() } : null,
      // one entry per day: "MM-DD spend/results"
      days: [...n.daily.entries()].sort((a, b) => a[0].localeCompare(b[0])).filter(([, d]) => d.spend > 0).map(([day, d]) => `${day.slice(5)} ${r2(d.spend)}/${Math.round(d.results)}`).join(" "),
    };
  };

  return {
    note: "Per ad set and per ad, live from Meta. days = 'MM-DD spend/results' for each day with spend. cost = per result (per 1000 reached for Reach). prevPeriod = same ad set or ad in the previous period.",
    campaigns: camps.map((k) => ({
      campaign: k.name,
      adsets: [...sets.values()].filter((s) => s.camp === k.meta_id && s.total.spend >= 1).sort((a, b) => b.total.spend - a.total.spend).map((s) => ({
        ...fmt(s),
        ads: [...ads.values()].filter((a) => a.adsetId === s.id && a.camp === k.meta_id && a.total.spend >= 1).sort((a, b) => b.total.spend - a.total.spend).slice(0, 8).map(fmt),
      })),
    })).filter((k) => k.adsets.length),
  };
}
