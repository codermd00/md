import { createServerSupabase } from "@/lib/supabase/server";
import PerformanceView, { type AdSetDTO, type BreakdownRow, type CampaignDTO, type DailyRow } from "@/components/PerformanceView";
import { addDays, todayStr } from "@/lib/dates";
import { computeProgress, previousPeriod } from "@/lib/progress";
import { cprValue } from "@/lib/results";
import { diagnose } from "@/lib/diagnose";

export const dynamic = "force-dynamic";
const MIN_SPEND = 0; // أي صرف > 0 يُحتسب

async function fetchAll<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await q(from, from + 999);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export default async function PerformancePage({ searchParams }: { searchParams: { client?: string; period?: string } }) {
  const sb = createServerSupabase();
  const today = todayStr();
  const [{ data: clients }, { data: setRows }] = await Promise.all([
    sb.from("clients").select("id,name,period_start,period_end,budget,ig_username").order("name"),
    sb.from("settings").select("key,value").eq("key", "late_threshold"),
  ]);
  const threshold = Number((setRows || [])[0]?.value) || 95;
  const list = clients || [];
  const client: any = list.find((c: any) => c.id === searchParams.client) || list[0] || null;

  if (!client) return <PerformanceView clients={[]} client={null} campaigns={[]} adsets={[]} breakdown={[]} daily={[]} today={today} threshold={threshold} />;

  // Archive: periods that were current before; ?period=<date_from> shows one of them
  const { data: periodRows } = await sb.from("insights_range").select("date_from,date_to").eq("level", "account").eq("entity_id", client.id).order("date_from", { ascending: false });
  const archive: { from: string; to: string }[] = [];
  for (const r of (periodRows || []) as any[]) {
    if (r.date_from === client.period_start || archive.some((a) => a.from === r.date_from)) continue;
    archive.push({ from: r.date_from, to: r.date_to });
  }
  const arch = archive.find((a) => a.from === searchParams.period);
  const vStart: string | null = arch ? arch.from : client.period_start;
  const vEnd: string | null = arch ? arch.to : client.period_end;
  const vToday = arch && arch.to < today ? arch.to : today;

  const prev = vStart && vEnd ? previousPeriod(vStart, vEnd) : null;
  const { data: camps } = await sb.from("campaigns").select("*").eq("client_id", client.id);
  const ids = (camps || []).map((k: any) => k.id);

  const { data: adsetRows } = await sb.from("ad_sets").select("id,campaign_id,name,effective_status").eq("client_id", client.id);
  const adsetIds = (adsetRows || []).map((a: any) => a.id);

  const [ranges, adsetRanges, breakdown, goals, daily] = await Promise.all([
    ids.length ? sb.from("insights_range").select("*").eq("level", "campaign").in("entity_id", ids).order("synced_at", { ascending: false }).then((r: any) => r.data || []) : [],
    adsetIds.length && vStart
      ? sb.from("insights_range").select("*").eq("level", "adset").eq("date_from", vStart).in("entity_id", adsetIds).order("synced_at", { ascending: false }).then((r: any) => r.data || [])
      : [],
    ids.length && vStart
      ? fetchAll<any>((a, b) => sb.from("insights_breakdown").select("level,entity_id,date_to,dimension,key,spend,impressions,clicks,reach,results,leads,follows")
          .eq("date_from", vStart).in("entity_id", [...ids, ...adsetIds]).range(a, b) as any)
      : [],
    vStart ? sb.from("campaign_goals").select("*").eq("period_start", vStart).in("campaign_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).then((r: any) => r.data || []) : [],
    fetchAll<any>((a, b) =>
      sb.from("insights_daily").select("entity_id,day,spend,results,impressions,clicks").eq("client_id", client.id).eq("level", "campaign")
        .gte("day", vStart || addDays(today, -45)).lte("day", arch ? arch.to : "9999-12-31").order("day").range(a, b) as any
    ),
  ]);

  const adsets: AdSetDTO[] = (adsetRows || []).map((a: any) => {
    const r = adsetRanges.find((x: any) => x.entity_id === a.id);
    return { id: a.id, campaignId: a.campaign_id, name: a.name, effectiveStatus: a.effective_status || "", spend: r ? Number(r.spend) : 0, results: r ? Number(r.results) : 0,
      impressions: r ? Number(r.impressions) : 0, clicks: r ? Number(r.clicks) : 0, reach: r ? Number(r.reach) : 0, follows: r ? Number(r.follows) || 0 : 0 };
  });

  const campaigns: CampaignDTO[] = (camps || [])
    .map((k: any) => {
      const cur = ranges.find((r: any) => r.entity_id === k.id && (!vStart || r.date_from === vStart));
      const pr = prev ? ranges.find((r: any) => r.entity_id === k.id && r.date_from === prev.from) : null;
      const g = goals.find((x: any) => x.campaign_id === k.id);
      const spend = cur ? Number(cur.spend) : 0;
      const result = cur ? Number(cur.results) : 0;
      const progress = computeProgress({
        type: k.type, periodStart: vStart, periodEnd: vEnd, today: vToday,
        result, spend, goalTarget: g?.target != null ? Number(g.target) : null,
        goalBudget: g?.budget != null ? Number(g.budget) : null, threshold,
      });
      const own = daily.filter((d: any) => d.entity_id === k.id).map((d: any) => ({
        day: d.day, spend: Number(d.spend), results: Number(d.results), impressions: Number(d.impressions), clicks: Number(d.clicks),
      }));
      const cprNow = cprValue(k.type, spend, result);
      const prevCprV = pr ? cprValue(k.type, Number(pr.spend), Number(pr.results)) : null;
      const findings = diagnose({
        type: k.type, effectiveStatus: k.effective_status || k.status || "", spend, result,
        cpr: cprNow, prevCpr: prevCprV, frequency: cur?.frequency != null ? Number(cur.frequency) : null,
        progress, goalBudget: g?.budget != null ? Number(g.budget) : null,
        daily: own, adsets: adsets.filter((a) => a.campaignId === k.id).map((a) => ({ name: a.name, effectiveStatus: a.effectiveStatus, spend: a.spend, results: a.results })),
        periodStart: vStart, periodEnd: vEnd, today: vToday,
      });
      return {
        findings, prevSpend: pr ? Number(pr.spend) : 0, prevResult: pr ? Number(pr.results) : 0,
        id: k.id, name: k.name, type: k.type, status: k.effective_status || k.status || "",
        spend, result, impressions: cur ? Number(cur.impressions) : 0, clicks: cur ? Number(cur.clicks) : 0, reach: cur ? Number(cur.reach) : 0, follows: cur ? Number(cur.follows) || 0 : 0,
        cpr: cprValue(k.type, spend, result),
        prevCpr: pr ? cprValue(k.type, Number(pr.spend), Number(pr.results)) : null,
        goalTarget: g?.target != null ? Number(g.target) : null,
        goalBudget: g?.budget != null ? Number(g.budget) : null,
        progress,
      } as CampaignDTO;
    })
    .filter((k: CampaignDTO) => k.spend > MIN_SPEND || k.goalTarget !== null || k.goalBudget !== null)
    .sort((a: CampaignDTO, b: CampaignDTO) => b.spend - a.spend);

  const dailyRows: DailyRow[] = daily.map((d: any) => ({
    campaignId: d.entity_id, day: d.day, spend: Number(d.spend), results: Number(d.results),
  }));

  const bdRows: BreakdownRow[] = breakdown.map((b: any) => ({
    level: b.level, entityId: b.entity_id, dateTo: b.date_to, dimension: b.dimension, key: b.key,
    spend: Number(b.spend), impressions: Number(b.impressions), clicks: Number(b.clicks), reach: Number(b.reach), results: Number(b.results), leads: Number(b.leads) || 0, follows: Number(b.follows) || 0,
  }));

  return (
    <PerformanceView
      clients={list.map((c: any) => ({ id: c.id, name: c.name }))}
      client={{
        id: client.id, name: client.name, periodStart: vStart, periodEnd: vEnd,
        budget: Number(client.budget) || 0
      }}
      periods={archive} periodSel={arch ? arch.from : ""} campaigns={campaigns} adsets={adsets} breakdown={bdRows} daily={dailyRows} today={vToday} threshold={threshold}
    />
  );
}
