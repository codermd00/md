import type { SupabaseClient } from "@supabase/supabase-js";
import { graph } from "./meta";
import { notifyEnabled, sendTelegram } from "./telegram";

const BASE_FIELDS = "id,username,media_type,caption,shortcode,permalink,timestamp,media_url,thumbnail_url,children{media_url}";
const LAST_N = 1;

async function storeThumb(db: SupabaseClient, clientId: string, mediaId: string, url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "image/jpeg";
    const path = `${clientId}/${mediaId}.jpg`;
    const { error } = await db.storage.from("thumbs").upload(path, Buffer.from(await res.arrayBuffer()), { contentType: type, upsert: true });
    return error ? null : path;
  } catch { return null; }
}

/** يجلب آخر منشور للعميل ويخزّنها. المنشور الجديد يُنشأ بحالة Ready وميزانية/أيام افتراضية. */
export async function syncPosts(db: SupabaseClient, c: { id: string; name: string; ig_user_id: string | null; run_posts?: boolean }, opts?: { limit?: number; force?: boolean }): Promise<string> {
  const limit = Math.min(Math.max(opts?.limit ?? LAST_N, 1), 50);
  // الحملات المنسوخة المنتهية → Done
  await db.from("posts").update({ status: "done" }).eq("client_id", c.id).eq("status", "running").lt("run_end_time", new Date().toISOString());
  if (c.run_posts === false && !opts?.force) return "";
  if (!c.ig_user_id) return "posts: no Instagram ID";

  let items: any[];
  try {
    const r = await graph<{ data: any[] }>(`${c.ig_user_id}/media`, { fields: BASE_FIELDS + ",boost_eligibility_info", limit });
    items = r.data || [];
  } catch {
    try {
      const r = await graph<{ data: any[] }>(`${c.ig_user_id}/media`, { fields: BASE_FIELDS, limit });
      items = r.data || [];
    } catch (e: any) { return "posts: " + (e?.message || "failed").slice(0, 120); }
  }
  if (!items.length) return "";

  const { data: existing } = await db.from("posts").select("id,ig_media_id,thumb_path").eq("client_id", c.id).is("copy_of", null).in("ig_media_id", items.map((m) => m.id));
  const known = new Map<string, { id: string; thumb_path: string | null }>((existing || []).map((p: any) => [p.ig_media_id, p]));
  const { data: setRows } = await db.from("settings").select("key,value").in("key", ["default_budget", "default_days"]);
  const def = (k: string, d: number) => Number((setRows || []).find((s: any) => s.key === k)?.value) || d;

  const fresh: string[] = [];
  for (const m of items) {
    const src = m.media_type === "VIDEO" ? m.thumbnail_url : (m.media_url || m.children?.data?.[0]?.media_url || m.thumbnail_url);
    const el = m.boost_eligibility_info;
    const eligible: boolean | null = el && typeof el.eligible_to_boost === "boolean" ? el.eligible_to_boost : null;
    const reason = el?.ineligible_reason || el?.ineligible_reasons?.[0] || null;
    const k = known.get(m.id);
    const thumb = !k?.thumb_path && src ? await storeThumb(db, c.id, m.id, src) : k?.thumb_path || null;

    if (k) {
      await db.from("posts").update({ eligible, ineligible_reason: reason, permalink: m.permalink, username: m.username, ...(thumb ? { thumb_path: thumb } : {}) }).eq("id", k.id);
    } else {
      await db.from("posts").insert({
        client_id: c.id, ig_media_id: m.id, shortcode: m.shortcode, permalink: m.permalink, media_type: m.media_type,
        caption: m.caption || null, username: m.username, thumb_path: thumb, posted_at: m.timestamp || null, eligible, ineligible_reason: reason,
        status: "ready", budget: def("default_budget", 200), days: def("default_days", 2),
      });
      fresh.push(m.shortcode || m.id);
    }
  }
  if (fresh.length && !opts?.force && (await notifyEnabled(db, "notify_new_post"))) {
    for (const sc of fresh.slice(0, 5)) await sendTelegram(`📸 New post — ${c.name}\nhttps://www.instagram.com/p/${sc}/`);
  }
  return "";
}
