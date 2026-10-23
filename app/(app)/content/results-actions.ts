"use server";
import { createServerSupabase } from "@/lib/supabase/server";
import { addDays, minDate, todayStr } from "@/lib/dates";
import { ordersKey, pullPostResults, type Goal } from "@/lib/post-results";
import type { CampaignType } from "@/lib/results";

export type PostResultRow = {
  key: string; ordersKey: string; name: string; dark: boolean; code: string | null; type: CampaignType; goal: Goal;
  ads: number; spend: number; result: number; visits: number; follows: number; reach: number;
  thumb: string; permalink: string; postedAt: string | null; mediaType: string; orders: number | null; verdict: Verdict | null;
};
export type Verdict = "good" | "mid" | "bad";
export type PostResultsOut = { ok: boolean; message: string; from: string; to: string; rows: PostResultRow[] };
export type RangeKey = "period" | "7d" | "30d";

export async function loadPostResults(clientId: string, range: RangeKey): Promise<PostResultsOut> {
  const fail = (message: string): PostResultsOut => ({ ok: false, message, from: "", to: "", rows: [] });
  const sb = createServerSupabase();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return fail("Unauthorized");
  const { data: c } = await sb.from("clients").select("ad_account_id,period_start,period_end").eq("id", clientId).maybeSingle();
  if (!c) return fail("Client not found");

  const today = todayStr();
  let from = range === "7d" ? addDays(today, -6) : range === "30d" ? addDays(today, -29) : c.period_start || addDays(today, -29);
  let to = range === "period" && c.period_end ? minDate(c.period_end, today) : today;
  if (from > to) { from = addDays(today, -29); to = today; }

  const [{ data: camps }, { data: posts }, { data: ord }, { data: vd }] = await Promise.all([
    sb.from("campaigns").select("meta_id,type").eq("client_id", clientId),
    sb.from("posts").select("shortcode,thumb_path,media_type,posted_at,permalink").eq("client_id", clientId).not("shortcode", "is", null).is("copy_of", null),
    sb.from("post_orders").select("code,orders").eq("client_id", clientId),
    sb.from("post_verdicts").select("key,verdict").eq("client_id", clientId),
  ]);
  const campTypes = new Map<string, CampaignType>(((camps || []) as any[]).map((k) => [String(k.meta_id), k.type as CampaignType]));
  const postBy = new Map<string, any>(((posts || []) as any[]).map((p) => [p.shortcode, p]));
  const orders = new Map<string, number>(((ord || []) as any[]).filter((o) => o.orders !== null).map((o) => [o.code, Number(o.orders)]));
  const verdicts = new Map<string, Verdict>(((vd || []) as any[]).map((v) => [v.key, v.verdict as Verdict]));
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

  try {
    const aggs = await pullPostResults(c.ad_account_id, from, to, campTypes, new Set(postBy.keys()));
    const rows: PostResultRow[] = aggs.map((a) => {
      const p = a.code ? postBy.get(a.code) : null;
      const ok = ordersKey(a);
      return {
        key: a.key, ordersKey: ok, name: a.name, dark: a.dark, code: a.code, type: a.type, goal: a.goal,
        ads: a.ads, spend: a.spend, result: a.result, visits: a.visits, follows: a.follows, reach: a.reach,
        thumb: p?.thumb_path ? `${base}/storage/v1/object/public/thumbs/${p.thumb_path}` : a.thumb,
        permalink: p?.permalink || (a.code ? `https://www.instagram.com/p/${a.code}/` : ""),
        postedAt: p?.posted_at || null, mediaType: p?.media_type || "",
        orders: a.goal === "sales" ? (orders.has(ok) ? orders.get(ok)! : null) : null,
        verdict: verdicts.get(a.key) || null,
      };
    });
    return { ok: true, message: "", from, to, rows };
  } catch (e: any) {
    return fail((e?.message || "Meta request failed").slice(0, 200));
  }
}

export async function saveOrders(clientId: string, code: string, value: string): Promise<{ ok: boolean; message: string }> {
  const sb = createServerSupabase();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return { ok: false, message: "Unauthorized" };
  const t = value.trim();
  if (t === "") {
    const { error } = await sb.from("post_orders").delete().eq("client_id", clientId).eq("code", code);
    return error ? { ok: false, message: error.message } : { ok: true, message: "" };
  }
  const n = Math.round(Number(t));
  if (!(n >= 0)) return { ok: false, message: "Invalid number" };
  const { error } = await sb.from("post_orders").upsert({ client_id: clientId, code, orders: n, updated_at: new Date().toISOString() }, { onConflict: "client_id,code" });
  return error ? { ok: false, message: error.message } : { ok: true, message: "" };
}

export async function saveVerdict(clientId: string, key: string, verdict: Verdict | ""): Promise<{ ok: boolean; message: string }> {
  const sb = createServerSupabase();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return { ok: false, message: "Unauthorized" };
  if (verdict === "") {
    const { error } = await sb.from("post_verdicts").delete().eq("client_id", clientId).eq("key", key);
    return error ? { ok: false, message: error.message } : { ok: true, message: "" };
  }
  if (!["good", "mid", "bad"].includes(verdict)) return { ok: false, message: "Invalid verdict" };
  const { error } = await sb.from("post_verdicts").upsert({ client_id: clientId, key, verdict, updated_at: new Date().toISOString() }, { onConflict: "client_id,key" });
  return error ? { ok: false, message: error.message } : { ok: true, message: "" };
}
