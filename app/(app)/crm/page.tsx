import { createServerSupabase } from "@/lib/supabase/server";
import CrmView, { type OrderRow, type GovRow, type DayRow, type Health } from "@/components/CrmView";
import { addDays, todayStr } from "@/lib/dates";
import { fetchAll } from "@/lib/fetchall";
import { metaRegionToGov, UNKNOWN_GOV } from "@/lib/governorates";

export const dynamic = "force-dynamic";

export default async function CrmPage({ searchParams }: { searchParams: { client?: string; range?: string } }) {
  const sb = createServerSupabase();
  const today = todayStr();
  const { data: clients } = await sb.from("clients").select("id,name,period_start,period_end,page_id,ig_user_id,synced_at").order("name");
  const list: any[] = clients || [];
  const client = list.find((c) => c.id === searchParams.client) || list[0] || null;
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

  // صحة الـ webhook (عامة، لا تخص عميلاً)
  const dayAgo = new Date(Date.now() - 86400000).toISOString();
  const [{ data: lastOk }, { data: recentLogs }] = await Promise.all([
    sb.from("webhook_log").select("created_at").eq("kind", "ok").order("created_at", { ascending: false }).limit(1),
    sb.from("webhook_log").select("kind,error,created_at,payload").gte("created_at", dayAgo).order("created_at", { ascending: false }).limit(100),
  ]);
  const health: Health = {
    url: supaUrl ? `${supaUrl}/functions/v1/meta-webhook` : "",
    lastEvent: lastOk?.[0]?.created_at || null,
    events24h: (recentLogs || []).filter((l: any) => l.kind === "ok").length,
    problems: (() => {
      const linked = new Set(list.flatMap((c) => [c.page_id, c.ig_user_id]).filter(Boolean));
      const seen = new Set<string>();
      const out: Health["problems"] = [];
      for (const l of (recentLogs || []).filter((x: any) => x.kind !== "ok")) {
        const entryId = l.payload?.entry?.[0]?.id ? String(l.payload.entry[0].id) : "";
        if (entryId && (linked.has(entryId) || seen.has(entryId))) continue; // رُبط لاحقاً أو مكرر
        if (entryId) seen.add(entryId);
        out.push({ kind: l.kind, error: l.error || "", at: l.created_at, entryId, object: String(l.payload?.object || "page") });
        if (out.length >= 3) break;
      }
      return out;
    })(),
  };

  if (!client) return <CrmView clients={[]} client={null} range="period" from="" to="" orders={[]} gov={[]} days={[]} kpi={null} health={health} govSpendNote="" sync={{ lastOk: null, failed: "" }} />;

  // نطاق التاريخ
  const range = ["today", "7", "30", "period"].includes(searchParams.range || "") ? (searchParams.range as string) : "period";
  let from = client.period_start || addDays(today, -29);
  let to = client.period_end && client.period_end < today ? client.period_end : today;
  if (range === "today") from = to = today;
  else if (range === "7") from = addDays(today, -6);
  else if (range === "30") from = addDays(today, -29);
  if (range !== "period") to = today;

  const { data: camps } = await sb.from("campaigns").select("id,type").eq("client_id", client.id);
  const msgIds = (camps || []).filter((k: any) => k.type === "messages").map((k: any) => k.id);

  const { data: lastLog } = await sb.from("sync_log").select("ok,detail,created_at").eq("client_id", client.id).order("created_at", { ascending: false }).limit(1);
  const sync = { lastOk: client.synced_at as string | null, failed: lastLog?.[0] && !lastLog[0].ok ? String(lastLog[0].detail || "") : "" };

  const [orders, convs, daily, regionRows] = await Promise.all([
    fetchAll<any>((a, b) => sb.from("crm_orders").select("id,phone,day,address,governorate,ad_id,platform,created_at").eq("client_id", client.id).gte("day", from).lte("day", to).order("day", { ascending: false }).order("created_at", { ascending: false }).range(a, b) as any),
    fetchAll<any>((a, b) => sb.from("crm_conversations").select("first_day").eq("client_id", client.id).gte("first_day", from).lte("first_day", to).range(a, b) as any),
    msgIds.length
      ? fetchAll<any>((a, b) => sb.from("insights_daily").select("day,spend,results,leads").eq("level", "campaign").in("entity_id", msgIds).gte("day", from).lte("day", to).range(a, b) as any)
      : Promise.resolve([] as any[]),
    msgIds.length && client.period_start && range === "period"
      ? fetchAll<any>((a, b) => sb.from("insights_breakdown").select("key,spend").eq("level", "campaign").eq("dimension", "region").eq("date_from", client.period_start).in("entity_id", msgIds).range(a, b) as any)
      : Promise.resolve([] as any[]),
  ]);

  const metaSpend = daily.reduce((s: number, r: any) => s + Number(r.spend), 0);
  const metaMsgs = daily.reduce((s: number, r: any) => s + Number(r.results), 0);
  const metaLeads = daily.reduce((s: number, r: any) => s + Number(r.leads || 0), 0);
  const nOrders = orders.length;
  const kpi = {
    metaMsgs, metaLeads, convs: convs.length, orders: nOrders, spend: metaSpend,
    ig: orders.filter((o: any) => o.platform === "instagram").length,
    fb: orders.filter((o: any) => o.platform === "facebook").length,
    rate: metaMsgs > 0 ? (nOrders / metaMsgs) * 100 : null,
    costOrder: nOrders > 0 ? metaSpend / nOrders : null,
    costLead: metaLeads > 0 ? metaSpend / metaLeads : null,
    hasMsgCampaigns: msgIds.length > 0 && daily.length > 0,
  };

  // أيام
  const days: DayRow[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days.push({
      day: d,
      orders: orders.filter((o: any) => o.day === d).length,
      msgs: daily.filter((r: any) => r.day === d).reduce((s: number, r: any) => s + Number(r.results), 0),
    });
  }

  // محافظات: طلبات CRM + صرف Meta للمنطقة (الفترة كاملة فقط)
  const spendBy = new Map<string, number>();
  let unmappedSpend = 0;
  for (const r of regionRows) {
    const g = metaRegionToGov(String(r.key));
    if (g) spendBy.set(g, (spendBy.get(g) || 0) + Number(r.spend)); else unmappedSpend += Number(r.spend);
  }
  const ordersBy = new Map<string, number>();
  for (const o of orders) { const g = o.governorate || UNKNOWN_GOV; ordersBy.set(g, (ordersBy.get(g) || 0) + 1); }
  const names = new Set<string>([...ordersBy.keys(), ...spendBy.keys()]);
  const gov: GovRow[] = [...names].map((g) => {
    const n = ordersBy.get(g) || 0, sp = spendBy.has(g) ? spendBy.get(g)! : null;
    return { name: g, orders: n, share: nOrders ? (n / nOrders) * 100 : 0, spend: sp, costOrder: sp !== null && n > 0 ? sp / n : null };
  }).sort((a, b) => b.orders - a.orders || (b.spend || 0) - (a.spend || 0));

  return (
    <CrmView
      clients={list.map((c) => ({ id: c.id, name: c.name }))}
      client={{ id: client.id, name: client.name }}
      range={range} from={from} to={to}
      orders={orders.slice(0, 300).map((o: any): OrderRow => ({ id: o.id, phone: o.phone, day: o.day, address: o.address || "", governorate: o.governorate || "", adId: o.ad_id || "" }))}
      gov={gov} days={days} kpi={kpi} health={health} sync={sync}
      govSpendNote={range !== "period" ? "" : unmappedSpend > 0.5 ? `Unmatched spend: $${unmappedSpend.toFixed(2)}` : ""}
    />
  );
}
