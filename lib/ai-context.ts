import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, todayStr } from "./dates";
import { campaignStart, computeProgress, previousPeriod } from "./progress";
import { cprValue, TYPE_LABEL, type CampaignType } from "./results";
import { liveBreakdown } from "./ai-live";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Compact JSON snapshot of one client's period for the AI. */
export async function buildContext(sb: SupabaseClient, clientId: string, periodStart?: string | null): Promise<string | null> {
  const { data: c } = await sb.from("clients").select("*").eq("id", clientId).maybeSingle();
  if (!c) return null;
  const today = todayStr();
  const { data: setRows } = await sb.from("settings").select("key,value").eq("key", "late_threshold");
  const threshold = Number((setRows || [])[0]?.value) || 95;

  let from: string | null = periodStart || c.period_start;
  let to: string | null = from === c.period_start ? c.period_end : null;
  if (from && !to) {
    const { data: pr } = await sb.from("insights_range").select("date_to").eq("level", "account").eq("entity_id", c.id).eq("date_from", from).order("synced_at", { ascending: false }).limit(1);
    to = (pr as any)?.[0]?.date_to || c.period_end;
  }
  const prev = from && to ? previousPeriod(from, to) : null;
  const now = to && to < today ? to : today;

  const { data: camps } = await sb.from("campaigns").select("*").eq("client_id", c.id);
  const ids = (camps || []).map((k: any) => k.id);
  if (!ids.length || !from) return JSON.stringify({ client: c.name, note: "No campaign data for this period" });

  const [{ data: ranges }, { data: goals }, { data: daily }, { data: sets }] = await Promise.all([
    sb.from("insights_range").select("*").eq("level", "campaign").in("entity_id", ids).order("synced_at", { ascending: false }),
    sb.from("campaign_goals").select("*").eq("period_start", from).in("campaign_id", ids),
    sb.from("insights_daily").select("entity_id,day,spend,results").eq("client_id", c.id).eq("level", "campaign").gte("day", addDays(now, -10)).lte("day", now).order("day"),
    sb.from("ad_sets").select("id,campaign_id,name,effective_status").eq("client_id", c.id),
  ]);
  const setIds = (sets || []).map((s: any) => s.id);
  const [{ data: setRanges }, { data: bd }] = await Promise.all([
    setIds.length ? sb.from("insights_range").select("entity_id,spend,results,impressions,clicks,reach").eq("level", "adset").eq("date_from", from).in("entity_id", setIds).order("synced_at", { ascending: false }) : Promise.resolve({ data: [] as any[] }),
    sb.from("insights_breakdown").select("entity_id,dimension,key,spend,results,date_to").eq("date_from", from).eq("level", "campaign").in("entity_id", ids).limit(1000),
  ]);

  const campaigns = (camps || []).map((k: any) => {
    const cur = (ranges || []).find((x: any) => x.entity_id === k.id && x.date_from === from);
    const pr = prev ? (ranges || []).find((x: any) => x.entity_id === k.id && x.date_from === prev.from) : null;
    const spend = cur ? Number(cur.spend) : 0, result = cur ? Number(cur.results) : 0;
    if (spend <= 0) return null;
    const g = (goals || []).find((x: any) => x.campaign_id === k.id);
    const p = computeProgress({
      type: k.type, periodStart: campaignStart(from, k.start_time, to), periodEnd: to, today: now, result, spend,
      goalTarget: g?.target != null ? Number(g.target) : null, goalBudget: g?.budget != null ? Number(g.budget) : null, threshold,
    });
    const type = k.type as CampaignType;
    const cpr = cprValue(type, spend, result);
    const prevCpr = pr ? cprValue(type, Number(pr.spend), Number(pr.results)) : null;
    const days = (daily || []).filter((d: any) => d.entity_id === k.id).map((d: any) => [d.day.slice(5), r2(Number(d.spend)), Number(d.results)]);
    const sl = new Map<string, any[]>();
    for (const b of (bd || []) as any[]) {
      if (b.entity_id !== k.id || Number(b.spend) <= 0) continue;
      const a = sl.get(b.dimension) || [];
      a.push(b);
      sl.set(b.dimension, a);
    }
    const breakdown: Record<string, any[]> = {};
    for (const [dim, rows] of sl) {
      const latest = new Map<string, any>();
      for (const b of rows) { const q = latest.get(b.key); if (!q || b.date_to > q.date_to) latest.set(b.key, b); }
      breakdown[dim] = [...latest.values()].sort((a, b) => Number(b.spend) - Number(a.spend)).slice(0, 6)
        .map((b) => ({ key: b.key, spend: r2(Number(b.spend)), results: Number(b.results), cpr: cprValue(type, Number(b.spend), Number(b.results)) }));
    }
    return {
      name: k.name, type: TYPE_LABEL[type], status: k.effective_status || k.status,
      spend: r2(spend), results: result, cpr: cpr === null ? null : r2(cpr), cprNote: type === "reach" ? "cost per 1000 reached" : "cost per result",
      prevPeriodCpr: prevCpr === null ? null : r2(prevCpr),
      goal: g?.target != null ? Number(g.target) : null, goalBudget: g?.budget != null ? Number(g.budget) : null,
      progress: p, lastDays_mmdd_spend_results: days,
      adsets: (sets || []).filter((s: any) => s.campaign_id === k.id).map((s: any) => {
        const x = (setRanges || []).find((r: any) => r.entity_id === s.id);
        return x && Number(x.spend) > 0 ? { name: s.name, status: s.effective_status, spend: r2(Number(x.spend)), results: Number(x.results), cpr: cprValue(type, Number(x.spend), Number(x.results)) } : null;
      }).filter(Boolean),
      breakdown,
    };
  }).filter(Boolean);

  // Live day-by-day numbers per ad set / ad (only the campaigns that spent); never saved
  let liveDaily: any = null;
  if (from && c.ad_account_id) {
    const spent = new Set((campaigns as any[]).map((x) => x.name));
    const list = (camps || []).filter((k: any) => spent.has(k.name)).map((k: any) => ({ meta_id: String(k.meta_id), name: k.name as string, type: k.type as CampaignType }));
    if (list.length) {
      try { liveDaily = await liveBreakdown(c.ad_account_id, { from, to: now }, prev, list); } catch { liveDaily = null; }
    }
  }

  return JSON.stringify({
    client: c.name, currency: c.currency || "USD", today: now, period: { from, to }, periodBudget: Number(c.budget) || null,
    alertLimits: c.alert_limits || null, campaigns, liveDaily,
  });
}
