import { createServerSupabase } from "@/lib/supabase/server";
import ContentView, { type PostCard } from "@/components/ContentView";

export const dynamic = "force-dynamic";

export default async function ContentPage() {
  const sb = createServerSupabase();
  const [{ data: clients }, { data: posts }] = await Promise.all([
    sb.from("clients").select("id,name,ig_user_id,run_posts,account_status").order("name"),
    sb.from("posts").select("*").eq("hidden", false).order("posted_at", { ascending: false }).limit(300),
  ]);
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const statusOf = new Map((clients || []).map((c: any) => [c.id, c.account_status || ""]));
  const nameOf = new Map((clients || []).map((c: any) => [c.id, c.name]));
  const cards: PostCard[] = (posts || []).filter((p: any) => nameOf.has(p.client_id)).map((p: any) => ({
    id: p.id, clientId: p.client_id, clientName: nameOf.get(p.client_id) || "", igMediaId: p.ig_media_id, shortcode: p.shortcode || "",
    permalink: p.permalink || "", mediaType: p.media_type || "", caption: p.caption || "", username: p.username || "",
    thumb: p.thumb_path ? `${base}/storage/v1/object/public/thumbs/${p.thumb_path}` : "", postedAt: p.posted_at,
    eligible: p.eligible, reason: p.ineligible_reason || "", status: p.status, mode: p.mode || "",
    budget: p.budget != null ? String(p.budget) : "", days: p.days != null ? String(p.days) : "",
    campId: p.meta_campaign_id || "", campName: p.meta_campaign_name || "", adsetId: p.meta_adset_id || "", adsetName: p.meta_adset_name || "",
    error: p.error || "", accountStatus: statusOf.get(p.client_id) || "", hasAd: !!p.ad_meta_id,
  }));
  return <ContentView clients={(clients || []).map((c: any) => ({ id: c.id, name: c.name, hasIg: !!c.ig_user_id, watch: !!c.run_posts }))} posts={cards} />;
}
