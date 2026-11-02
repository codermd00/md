"use server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { syncClient, syncAll } from "@/lib/sync";
import { normAct } from "@/lib/meta";

async function requireUser() {
  const sb = createServerSupabase();
  const { data } = await sb.auth.getUser();
  if (!data.user) throw new Error("Unauthorized");
  return sb;
}

export type ClientInput = {
  id?: string; name: string; ig_username: string; ad_account_id: string;
  period_start: string; period_end: string; budget: string; business_type: string; city: string;
  page_id: string; ig_user_id: string; run_posts: boolean;
  alert_messages: string; alert_engagement: string; alert_reach: string; alert_visit: string; alert_leads: string; alert_thruplay: string;
};

/** New period: existing campaigns keep their budget and target from their latest earlier period. New campaigns are left for manual entry. */
async function carryOverGoals(sb: ReturnType<typeof createServerSupabase>, clientId: string, newStart: string) {
  try {
    const { data: camps } = await sb.from("campaigns").select("id").eq("client_id", clientId);
    const ids = (camps || []).map((c: any) => c.id);
    if (!ids.length) return;
    const { data: goals } = await sb.from("campaign_goals").select("campaign_id,period_start,budget,target").in("campaign_id", ids).limit(5000);
    const has = new Set<string>(), last = new Map<string, any>();
    for (const g of (goals || []) as any[]) {
      if (g.period_start === newStart) { has.add(g.campaign_id); continue; }
      if (g.period_start > newStart || (g.budget === null && g.target === null)) continue;
      const cur = last.get(g.campaign_id);
      if (!cur || g.period_start > cur.period_start) last.set(g.campaign_id, g);
    }
    const rows = [...last.values()].filter((g) => !has.has(g.campaign_id))
      .map((g) => ({ campaign_id: g.campaign_id, period_start: newStart, budget: g.budget, target: g.target, source: "manual" }));
    if (rows.length) await sb.from("campaign_goals").insert(rows);
  } catch { /* optional */ }
}

export async function saveClient(input: ClientInput): Promise<{ ok: boolean; message: string }> {
  const sb = await requireUser();
  const name = input.name.trim();
  const acc = normAct(input.ad_account_id);
  if (!name) return { ok: false, message: "Name is required" };
  if (!/^\d{6,}$/.test(acc)) return { ok: false, message: "Invalid ad account ID" };
  if (input.period_start && input.period_end && input.period_end < input.period_start)
    return { ok: false, message: "Period end is before start" };

  const pageId = input.page_id.trim(), igId = input.ig_user_id.trim();
  if ((pageId && !/^\d{5,}$/.test(pageId)) || (igId && !/^\d{5,}$/.test(igId)))
    return { ok: false, message: "Page ID / Instagram ID must be numbers" };
  for (const [col, v] of [["page_id", pageId], ["ig_user_id", igId]] as const) {
    if (!v) continue;
    const { data: dup } = await sb.from("clients").select("name").eq(col, v).neq("id", input.id || "00000000-0000-0000-0000-000000000000").limit(1);
    if (dup?.length) return { ok: false, message: `${col === "page_id" ? "Page ID" : "Instagram ID"} already used by ${dup[0].name}` };
  }

  const row = {
    page_id: pageId || null, ig_user_id: igId || null, run_posts: !!input.run_posts,
    alert_limits: Object.fromEntries(
      (["messages", "engagement", "reach", "visit", "leads", "thruplay"] as const)
        .map((t) => [t, Number((input as any)["alert_" + t])] as const).filter(([, v]) => v > 0)
    ),
    name, ad_account_id: acc,
    ig_username: input.ig_username.trim().replace(/^@/, "") || null,
    period_start: input.period_start || null, period_end: input.period_end || null,
    budget: Number(input.budget) || 0,
    business_type: input.business_type.trim() || null, city: input.city.trim() || null,
  };
  let id = input.id;
  let oldStart: string | null = null;
  if (id) {
    const { data: old } = await sb.from("clients").select("period_start").eq("id", id).maybeSingle();
    oldStart = old?.period_start || null;
    const { error } = await sb.from("clients").update(row).eq("id", id);
    if (error) return { ok: false, message: error.code === "23505" ? "This ad account belongs to another client" : error.message };
  } else {
    const { data, error } = await sb.from("clients").insert(row).select("id").single();
    if (error) return { ok: false, message: error.code === "23505" ? "This ad account belongs to another client" : error.message };
    id = data.id;
  }
  if (row.period_start && row.period_start !== oldStart) await carryOverGoals(sb, id!, row.period_start);
  const r = await syncClient(id!);
  revalidatePath("/clients");
  return { ok: true, message: r.ok ? `Saved and synced (${r.detail})` : `Saved, but sync failed: ${r.detail}` };
}

export async function deleteClient(id: string): Promise<{ ok: boolean; message: string }> {
  const sb = await requireUser();
  const { error } = await sb.from("clients").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/clients");
  return { ok: true, message: "Deleted" };
}

export async function syncNow(id?: string): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  if (id) {
    const r = await syncClient(id);
    revalidatePath("/clients"); revalidatePath(`/clients/${id}`);
    return { ok: r.ok, message: r.detail };
  }
  const rs = await syncAll();
  revalidatePath("/clients");
  const bad = rs.filter((r) => !r.ok);
  return { ok: bad.length === 0, message: bad.length ? `${bad.length} failed: ${bad[0].detail}` : `Synced ${rs.length} client(s)` };
}
