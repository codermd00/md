// Watch: live numbers for the items the user chose to monitor (server only)
import { graph, graphAll } from "./meta";
import { cprValue, resultFor, TYPE_LABEL, type CampaignType } from "./results";
import { addDays, diffDays } from "./dates";

export type WatchLevel = "campaign" | "adset" | "ad";
export type WatchFlag = "stop" | "worse" | "over" | "better" | "same" | "new";

const FIELDS = "spend,impressions,reach,actions,instagram_profile_visits";

/** Live totals from Meta for one entity over a day range (inclusive). */
export async function liveTotals(act: string, level: WatchLevel, metaId: string, since: string, until: string, type: CampaignType) {
  if (since > until) return { spend: 0, results: 0 };
  const rows = await graphAll<any>(`act_${act}/insights`, {
    level, fields: FIELDS,
    time_range: JSON.stringify({ since, until }),
    filtering: JSON.stringify([{ field: `${level}.id`, operator: "IN", value: [metaId] }]),
  }, 3);
  let spend = 0, results = 0;
  for (const r of rows) { spend += Number(r.spend) || 0; results += resultFor(type, r); }
  return { spend, results };
}

export const costText = (type: CampaignType, v: number | null) =>
  v === null ? "—" : "$" + (v < 0.01 ? v.toFixed(3) : v.toFixed(2)) + (type === "reach" ? " /1K" : "");

export function judge(p: { type: CampaignType; spend: number; results: number; before: number | null; limit: number; days: number }): WatchFlag {
  const cost = cprValue(p.type, p.spend, p.results);
  if (p.spend <= 0) return p.days >= 2 ? "stop" : "new";
  if (cost === null) return p.limit > 0 && p.type !== "reach" && p.spend >= p.limit ? "worse" : "new";
  if (p.before !== null && cost > p.before * 1.1) return "worse";
  if (p.limit > 0 && cost > p.limit) return "over";
  if (p.before !== null && cost < p.before * 0.9) return "better";
  if (p.before === null && p.limit > 0 && cost <= p.limit) return "better";
  return "same";
}

export type WatchRow = {
  id: string; clientId: string; clientName: string; level: WatchLevel; name: string; type: string; typeLabel: string;
  note: string; startedOn: string; days: number; status: "open" | "closed"; spend: number; results: number;
  cost: string; before: string; limit: string | null; flag: WatchFlag; closedOn: string; closeNote: string; error: string;
  parentCamp: string; parentAdset: string;
};

const RANK: Record<WatchFlag, number> = { stop: 0, worse: 0, over: 1, new: 2, same: 2, better: 3 };

export async function loadWatch(sb: any, today: string, withClosed = false): Promise<WatchRow[]> {
  const [{ data: items }, { data: clients }] = await Promise.all([
    sb.from("watch_items").select("*").order("created_at", { ascending: false }).limit(300),
    sb.from("clients").select("id,name,ad_account_id,alert_limits"),
  ]);
  if (!items) return [];
  const cl = new Map<string, any>(((clients || []) as any[]).map((c) => [c.id, c]));
  const list = (items as any[]).filter((i) => i.status === "open" || withClosed);

  // fill in the campaign / ad set of older items once, then remember it
  await Promise.all(list.filter((i) => i.level !== "campaign" && i.parent_camp == null).map(async (i) => {
    try {
      const info = await graph<any>(i.meta_id, { fields: i.level === "ad" ? "campaign{name},adset{name}" : "campaign{name}" });
      i.parent_camp = info.campaign?.name || ""; i.parent_adset = info.adset?.name || "";
      await sb.from("watch_items").update({ parent_camp: i.parent_camp, parent_adset: i.parent_adset }).eq("id", i.id);
    } catch { /* shown without a parent */ }
  }));

  const rows = await Promise.all(list.map(async (i): Promise<WatchRow> => {
    const c = cl.get(i.client_id);
    const type = (i.type || "other") as CampaignType;
    const open = i.status === "open";
    let spend = Number(i.final_spend) || 0, results = Number(i.final_results) || 0, error = "";
    const end = open ? today : (i.closed_on || today);
    if (open) {
      try {
        const t = await liveTotals(c?.ad_account_id || "", i.level, i.meta_id, i.started_on, today, type);
        spend = t.spend; results = t.results;
      } catch (e: any) { error = String(e?.message || "Meta request failed").slice(0, 100); }
    }
    const lim = Number(c?.alert_limits?.[type]) || 0;
    const before = cprValue(type, Number(i.before_spend) || 0, Number(i.before_results) || 0);
    const days = diffDays(i.started_on, end) + 1;
    const flag = error ? ((i.last_flag as WatchFlag) || "new") : judge({ type, spend, results, before, limit: lim, days });
    return {
      id: i.id, clientId: i.client_id, clientName: c?.name || "—", level: i.level, name: i.name, type, typeLabel: TYPE_LABEL[type] || "Other",
      note: i.note || "", startedOn: i.started_on, days, status: i.status, spend, results,
      cost: costText(type, cprValue(type, spend, results)), before: costText(type, before),
      limit: lim > 0 ? costText(type, lim) : null, flag, closedOn: i.closed_on || "", closeNote: i.close_note || "", error,
      parentCamp: i.parent_camp || "", parentAdset: i.parent_adset || "",
    };
  }));

  rows.sort((a, b) => (a.status === b.status ? RANK[a.flag] - RANK[b.flag] : a.status === "open" ? -1 : 1));
  return rows;
}

export { addDays };
