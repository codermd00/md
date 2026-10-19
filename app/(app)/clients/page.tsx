import { createServerSupabase } from "@/lib/supabase/server";
import ClientsGrid, { type ClientCard } from "@/components/ClientsGrid";
import { daysLeft } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const sb = createServerSupabase();
  const [{ data: clients }, { data: ranges }] = await Promise.all([
    sb.from("clients").select("*").order("name"),
    sb.from("insights_range").select("entity_id,date_from,date_to,spend,synced_at").eq("level", "account").order("synced_at", { ascending: false }),
  ]);

  const cards: ClientCard[] = (clients || []).map((c: any) => {
    const r = (ranges || []).find((x: any) => x.entity_id === c.id && (!c.period_start || x.date_from === c.period_start));
    return {
      id: c.id, name: c.name, ig_username: c.ig_username, page_id: c.page_id, ig_user_id: c.ig_user_id, run_posts: c.run_posts !== false,
      alert_messages: c.alert_limits?.messages != null ? String(c.alert_limits.messages) : "", alert_engagement: c.alert_limits?.engagement != null ? String(c.alert_limits.engagement) : "",
      alert_reach: c.alert_limits?.reach != null ? String(c.alert_limits.reach) : "", alert_visit: c.alert_limits?.visit != null ? String(c.alert_limits.visit) : "", alert_leads: c.alert_limits?.leads != null ? String(c.alert_limits.leads) : "", alert_thruplay: c.alert_limits?.thruplay != null ? String(c.alert_limits.thruplay) : "", ad_account_id: c.ad_account_id,
      period_start: c.period_start, period_end: c.period_end, budget: Number(c.budget) || 0,
      business_type: c.business_type, city: c.city, account_status: c.account_status,
      spend: r ? Number(r.spend) : 0, daysLeft: daysLeft(c.period_end), synced_at: c.synced_at,
    };
  });
  return <ClientsGrid clients={cards} />;
}
