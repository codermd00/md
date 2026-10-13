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

export default async function PerformancePage({ searchParams }: { searchParams: { client?: string } }) {
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

  const prev = client.period_start && client.period_end ? previousPeriod(client.period_start, client.period_end) : null;
  const { data: camps } = await sb.from("campaigns").select("*").eq("client_id", client.id);
  const ids = (camps || []).map((k: any) => k.id);

  const { data: adsetRows } = await sb.from("ad_sets").select("id,campaign_id,name,effective_status").eq("client_id", client.id);
  const adsetIds = (adsetRows || []).map((a: any) => a.id);

  const [ranges, adsetRanges, breakdown, goals, daily] = await Promise.all([
    ids.length ? sb.from("insights_range").select("*").eq("level", "campaign").in("entity_id", ids).order("synced_at", { ascending: false }).then((r: any) => r.data || []) : [],
    adsetIds.length && client.period_start
      ? sb.from("insights_range").select("*").eq("level", "adset").eq("date_from", client.period_start).in("entity_id", adsetIds).then((r: any) => r.data || [])
      : [],
    ids.length && client.period_start
      ? fetchAll<any>((a, b) => sb.from("insights_breakdown").select("level,entity_id,date_to,dimension,key,spend,impressions,clicks,reach,results,leads")
          .eq("date_from", client.period_start).in("entity_id", [...ids, ...adsetIds]).range(a, b) as any)
      : [],
    client.period_start ? sb.from("campaign_goals").select("*").eq("period_start", client.period_start).in("campaign_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).then((r: any) => r.data || []) : [],
    fetchAll<any>((a, b) =>
      sb.from("insights_daily").select("entity_id,day,spend,results,impressions,clicks").eq("client_id", client.id).eq("level", "campaign")
        .gte("day", client.period_start || addDays(today, -45)).order("day").range(a, b) as any
    ),
  ]);

  const adsets: AdSetDTO[] = (adsetRows || []).map((a: any) => {
    const r = adsetRanges.find((x: any) => x.entity_id === a.id);
    return { id: a.id, campaignId: a.campaign_id, name: a.name, effectiveStatus: a.effective_status || "", spend: r ? Number(r.spend) : 0, results: r ? Number(r.results) : 0 };
  });

  const campaigns: CampaignDTO[] = (camps || [])
    .map((k: any) => {
      const cur = ranges.find((r: any) => r.entity_id === k.id && (!client.period_start || r.date_from === client.period_start));
      const pr = prev ? ranges.find((r: any) => r.entity_id === k.id && r.date_from === prev.from) : null;
      const g = goals.find((x: any) => x.campaign_id === k.id);
      const spend = cur ? Number(cur.spend) : 0;
      const result = cur ? Number(cur.results) : 0;
      const progress = computeProgress({
        type: k.type, periodStart: client.period_start, periodEnd: client.period_end, today,
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
        periodStart: client.period_start, periodEnd: client.period_end, today,
      });
      return {
        findings, prevSpend: pr ? Number(pr.spend) : 0, prevResult: pr ? Number(pr.results) : 0,
        id: k.id, name: k.name, type: k.type, status: k.effective_status || k.status || "",
        spend, result,
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
    spend: Number(b.spend), impressions: Number(b.impressions), clicks: Number(b.clicks), reach: Number(b.reach), results: Number(b.results), leads: Number(b.leads) || 0,
  }));

  return (
    <PerformanceView
      clients={list.map((c: any) => ({ id: c.id, name: c.name }))}
      client={{
        id: client.id, name: client.name, periodStart: client.period_start, periodEnd: client.period_end,
        budget: Number(client.budget) || 0
      }}
      campaigns={campaigns} adsets={adsets} breakdown={bdRows} daily={dailyRows} today={today} threshold={threshold}
    />
  );
}
