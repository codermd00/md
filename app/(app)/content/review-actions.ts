"use server";
import { createServerSupabase } from "@/lib/supabase/server";
import { graphAll } from "@/lib/meta";
import { codeOf } from "@/lib/post-results";

async function user() {
  const sb = createServerSupabase();
  const { data } = await sb.auth.getUser();
  return data.user ? sb : null;
}

export type NoAdPost = { id: string; shortcode: string; thumb: string; mediaType: string; postedAt: string | null; permalink: string };
export type ReviewOut = { ok: boolean; message: string; lastReviewed: string | null; noAd: NoAdPost[] };

/** Weekly review data: when it was last done, and recent posts that have no ad at all. */
export async function loadReview(clientId: string): Promise<ReviewOut> {
  const sb = await user();
  if (!sb) return { ok: false, message: "Unauthorized", lastReviewed: null, noAd: [] };
  const { data: c } = await sb.from("clients").select("ad_account_id").eq("id", clientId).maybeSingle();
  const { data: rv } = await sb.from("post_reviews").select("reviewed_at").eq("client_id", clientId).maybeSingle();
  const lastReviewed = (rv as any)?.reviewed_at || null;
  if (!c) return { ok: false, message: "Client not found", lastReviewed, noAd: [] };

  const since = new Date(Date.now() - 45 * 86400000).toISOString();
  const { data: posts } = await sb.from("posts").select("id,shortcode,thumb_path,media_type,posted_at,permalink,ad_meta_id")
    .eq("client_id", clientId).eq("hidden", false).neq("status", "skip").is("copy_of", null).not("shortcode", "is", null).gte("posted_at", since)
    .order("posted_at", { ascending: false });
  const list = (posts || []) as any[];
  try {
    const ads = await graphAll<any>(`act_${c.ad_account_id}/ads`, { fields: "name" }, 30);
    const known = new Set<string>(list.map((p) => p.shortcode));
    const used = new Set<string>();
    for (const a of ads) { const code = codeOf(String(a.name || ""), known); if (code) used.add(code); }
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const noAd: NoAdPost[] = list.filter((p) => !p.ad_meta_id && !used.has(p.shortcode)).map((p) => ({
      id: p.id, shortcode: p.shortcode, mediaType: p.media_type || "", postedAt: p.posted_at, permalink: p.permalink || `https://www.instagram.com/p/${p.shortcode}/`,
      thumb: p.thumb_path ? `${base}/storage/v1/object/public/thumbs/${p.thumb_path}` : "",
    }));
    return { ok: true, message: "", lastReviewed, noAd };
  } catch (e: any) {
    return { ok: false, message: (e?.message || "Meta request failed").slice(0, 160), lastReviewed, noAd: [] };
  }
}

export async function markReviewed(clientId: string): Promise<{ ok: boolean; message: string; at: string }> {
  const sb = await user();
  if (!sb) return { ok: false, message: "Unauthorized", at: "" };
  const at = new Date().toISOString();
  const { error } = await sb.from("post_reviews").upsert({ client_id: clientId, reviewed_at: at }, { onConflict: "client_id" });
  return error ? { ok: false, message: error.message, at: "" } : { ok: true, message: "", at };
}

export type MonthOrder = { month: string; branch: string; orders: number; msgOrders: number | null; baseline: boolean };

export async function loadMonthOrders(clientId: string): Promise<MonthOrder[]> {
  const sb = await user();
  if (!sb) return [];
  const { data } = await sb.from("client_month_orders").select("month,branch,orders,msg_orders,baseline").eq("client_id", clientId).order("month", { ascending: true });
  return ((data || []) as any[]).map((r) => ({ month: r.month, branch: r.branch || "", orders: Number(r.orders), msgOrders: r.msg_orders === null ? null : Number(r.msg_orders), baseline: !!r.baseline }));
}

export async function saveMonthOrder(clientId: string, m: { month: string; branch: string; orders: string; msgOrders: string; baseline: boolean }): Promise<{ ok: boolean; message: string }> {
  const sb = await user();
  if (!sb) return { ok: false, message: "Unauthorized" };
  if (!/^\d{4}-\d{2}$/.test(m.month)) return { ok: false, message: "Pick a month" };
  const orders = Math.round(Number(m.orders));
  if (m.orders.trim() === "" || !(orders >= 0)) return { ok: false, message: "Enter the orders number" };
  const msg = m.msgOrders.trim() === "" ? null : Math.round(Number(m.msgOrders));
  if (msg !== null && !(msg >= 0)) return { ok: false, message: "Invalid number" };
  const { error } = await sb.from("client_month_orders").upsert(
    { client_id: clientId, month: m.month, branch: m.branch.trim(), orders, msg_orders: msg, baseline: m.baseline, updated_at: new Date().toISOString() },
    { onConflict: "client_id,month,branch" });
  return error ? { ok: false, message: error.message } : { ok: true, message: "" };
}

export async function deleteMonthOrder(clientId: string, month: string, branch: string): Promise<{ ok: boolean; message: string }> {
  const sb = await user();
  if (!sb) return { ok: false, message: "Unauthorized" };
  const { error } = await sb.from("client_month_orders").delete().eq("client_id", clientId).eq("month", month).eq("branch", branch);
  return error ? { ok: false, message: error.message } : { ok: true, message: "" };
}
