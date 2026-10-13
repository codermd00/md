import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { graph, graphAll, normAct } from "@/lib/meta";

export const dynamic = "force-dynamic";

// تشخيص (يتطلب تسجيل الدخول): /api/diag?client=<uuid>            ← action_types الخام
//                              /api/diag?client=<uuid>&probe=1    ← تجربة حقول قد تحمل نتيجة Visit
export async function GET(req: NextRequest) {
  const sb = createServerSupabase();
  const { data: user } = await sb.auth.getUser();
  if (!user.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("client");
  const { data: c } = await sb.from("clients").select("*").eq("id", id || "").single();
  if (!c) return NextResponse.json({ error: "client not found" }, { status: 404 });
  const today = new Date().toISOString().slice(0, 10);
  const until = c.period_end && c.period_end < today ? c.period_end : today;
  const act = `act_${normAct(c.ad_account_id)}`;
  const range = JSON.stringify({ since: c.period_start || until, until });

  // /api/diag?client=<uuid>&bd=region[&name=Msg] ← صفوف التوزيع الخام كما ترجعها Meta
  const bd = req.nextUrl.searchParams.get("bd");
  if (bd) {
    const name = req.nextUrl.searchParams.get("name") || "Msg";
    const out: Record<string, unknown> = {};
    for (const [label, fields] of Object.entries({
      with_actions: "campaign_name,spend,impressions,reach,actions",
      with_results: "campaign_name,spend,results,cost_per_result",
    })) {
      try {
        const r = await graph<any>(`${act}/insights`, {
          level: "campaign", fields, breakdowns: bd === "placement" ? "publisher_platform,platform_position" : bd === "platform" ? "publisher_platform" : bd,
          time_range: range, limit: 4, filtering: JSON.stringify([{ field: "campaign.name", operator: "CONTAIN", value: name }]),
        });
        out[label] = r.data ?? r;
      } catch (e: any) { out[label] = "ERROR: " + e.message; }
    }
    return NextResponse.json(out);
  }

  if (req.nextUrl.searchParams.get("probe")) {
    const fields = [
      "results", "cost_per_result", "instagram_profile_visits", "cost_per_instagram_profile_visit",
      "inline_link_clicks", "outbound_clicks", "unique_actions", "conversions", "unique_inline_link_clicks",
      "actions:instagram_profile_visit", "result_rate",
    ];
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      try {
        const r = await graph<any>(`${act}/insights`, {
          level: "campaign", fields: `campaign_name,${f}`, time_range: range, filtering: JSON.stringify([{ field: "campaign.name", operator: "CONTAIN", value: "visit" }]),
        });
        out[f] = r.data?.[0] ?? "no data";
      } catch (e: any) { out[f] = "ERROR: " + e.message; }
    }
    return NextResponse.json(out);
  }

  const rows = await graphAll<any>(`${act}/insights`, {
    level: "campaign", fields: "campaign_name,spend,reach,actions", time_range: range,
  });
  return NextResponse.json(rows.map((r: any) => ({
    campaign: r.campaign_name, spend: r.spend, reach: r.reach,
    actions: (r.actions || []).map((a: any) => `${a.action_type} = ${a.value}`),
  })));
}
