"use server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { graph, graphAll } from "@/lib/meta";
import { addDays, todayStr } from "@/lib/dates";
import { liveTotals, type WatchLevel } from "@/lib/watch";
import type { CampaignType } from "@/lib/results";

type Res = { ok: boolean; message: string };
const refresh = () => { revalidatePath("/overview"); revalidatePath("/watch"); };

export async function addWatch(input: {
  level: WatchLevel; dbId?: string; postId?: string; clientId?: string; metaId?: string; name?: string; note?: string;
}): Promise<Res> {
  const sb = createServerSupabase();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return { ok: false, message: "Unauthorized" };

  let clientId = input.clientId || "", metaId = input.metaId || "", name = input.name || "", type: CampaignType = "other";
  if (input.level === "campaign" && input.dbId) {
    const { data } = await sb.from("campaigns").select("client_id,meta_id,name,type").eq("id", input.dbId).maybeSingle();
    if (!data) return { ok: false, message: "Campaign not found" };
    clientId = data.client_id; metaId = data.meta_id; name = data.name; type = data.type;
  } else if (input.level === "adset" && input.dbId) {
    const { data } = await sb.from("ad_sets").select("client_id,meta_id,name,campaign_id").eq("id", input.dbId).maybeSingle();
    if (!data) return { ok: false, message: "Ad set not found" };
    const { data: parent } = await sb.from("campaigns").select("type").eq("id", data.campaign_id).maybeSingle();
    clientId = data.client_id; metaId = data.meta_id; name = data.name; type = (parent?.type as CampaignType) || "other";
  } else if (input.level === "ad") {
    if (input.postId) {
      const { data } = await sb.from("posts").select("client_id,ad_meta_id,shortcode").eq("id", input.postId).maybeSingle();
      if (!data?.ad_meta_id) return { ok: false, message: "This post has no ad yet" };
      clientId = data.client_id; metaId = data.ad_meta_id; name = data.shortcode || "Ad";
    }
    if (!clientId || !metaId) return { ok: false, message: "Missing ad" };
    try {
      const ad = await graph<any>(metaId, { fields: "name,campaign_id" });
      if (!name) name = ad.name || "Ad";
      if (ad.campaign_id) {
        const { data: camp } = await sb.from("campaigns").select("type").eq("meta_id", String(ad.campaign_id)).maybeSingle();
        if (camp?.type) type = camp.type;
      }
    } catch { /* type stays "other" */ }
  } else return { ok: false, message: "Missing item" };

  const { data: dup } = await sb.from("watch_items").select("id").eq("meta_id", metaId).eq("status", "open").maybeSingle();
  if (dup) return { ok: false, message: "Already watching this" };
  const { data: client } = await sb.from("clients").select("ad_account_id").eq("id", clientId).maybeSingle();
  if (!client) return { ok: false, message: "Client not found" };

  const today = todayStr();
  let bs = 0, br = 0;
  try { const b = await liveTotals(client.ad_account_id, input.level, metaId, addDays(today, -3), addDays(today, -1), type); bs = b.spend; br = b.results; } catch { /* no snapshot */ }

  const { error } = await sb.from("watch_items").insert({
    client_id: clientId, level: input.level, meta_id: metaId, name, type, note: (input.note || "").trim() || null,
    started_on: today, before_spend: bs, before_results: br,
  });
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Watching" };
}

export async function closeWatch(id: string, note: string): Promise<Res> {
  const sb = createServerSupabase();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return { ok: false, message: "Unauthorized" };
  const { data: i } = await sb.from("watch_items").select("*").eq("id", id).maybeSingle();
  if (!i) return { ok: false, message: "Not found" };
  const { data: client } = await sb.from("clients").select("ad_account_id").eq("id", i.client_id).maybeSingle();
  const today = todayStr();
  let spend = 0, results = 0;
  try { const t = await liveTotals(client?.ad_account_id || "", i.level, i.meta_id, i.started_on, today, i.type); spend = t.spend; results = t.results; } catch { /* keep zeros */ }
  const { error } = await sb.from("watch_items").update({
    status: "closed", closed_on: today, close_note: note.trim() || null, final_spend: spend, final_results: results,
  }).eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Closed" };
}

export async function deleteWatch(id: string): Promise<Res> {
  const sb = createServerSupabase();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return { ok: false, message: "Unauthorized" };
  const { error } = await sb.from("watch_items").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Deleted" };
}

export type Target = { key: string; name: string; sub: string };

/** Things that can be added: campaigns / ad sets from the database, ads live from Meta. */
export async function listTargets(clientId: string, level: WatchLevel): Promise<{ ok: boolean; message: string; items: Target[] }> {
  const sb = createServerSupabase();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return { ok: false, message: "Unauthorized", items: [] };
  const st = (s: string | null) => (s && s !== "ACTIVE" ? "Paused" : "Active");
  if (level === "campaign") {
    const { data } = await sb.from("campaigns").select("id,name,effective_status").eq("client_id", clientId).order("last_spend", { ascending: false }).limit(200);
    return { ok: true, message: "", items: ((data || []) as any[]).map((x) => ({ key: x.id, name: x.name, sub: st(x.effective_status) })) };
  }
  if (level === "adset") {
    const { data } = await sb.from("ad_sets").select("id,name,effective_status").eq("client_id", clientId).order("created_at", { ascending: false }).limit(300);
    return { ok: true, message: "", items: ((data || []) as any[]).map((x) => ({ key: x.id, name: x.name, sub: st(x.effective_status) })) };
  }
  const { data: client } = await sb.from("clients").select("ad_account_id").eq("id", clientId).maybeSingle();
  if (!client) return { ok: false, message: "Client not found", items: [] };
  try {
    const ads = await graphAll<any>(`act_${client.ad_account_id}/ads`, {
      fields: "name,effective_status,adset{name}", effective_status: JSON.stringify(["ACTIVE", "PAUSED"]), limit: 100,
    }, 3);
    return { ok: true, message: "", items: ads.map((a) => ({ key: String(a.id), name: a.name || "Ad", sub: `${st(a.effective_status)}${a.adset?.name ? " · " + a.adset.name : ""}` })) };
  } catch (e: any) { return { ok: false, message: String(e?.message || "Meta request failed").slice(0, 120), items: [] }; }
}
