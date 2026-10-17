"use server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { graph, graphAll } from "@/lib/meta";
import { addDays, todayStr } from "@/lib/dates";
import { liveTotals, type WatchLevel } from "@/lib/watch";
import { typeFromGoal, type CampaignType } from "@/lib/results";

type Res = { ok: boolean; message: string };
const refresh = () => { revalidatePath("/overview"); revalidatePath("/watch"); };

export async function addWatch(input: {
  level: WatchLevel; dbId?: string; postId?: string; clientId?: string; metaId?: string; name?: string; note?: string;
}): Promise<Res> {
  const sb = createServerSupabase();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return { ok: false, message: "Unauthorized" };

  let clientId = input.clientId || "", metaId = input.metaId || "", name = input.name || "", type: CampaignType = "other";
  let parentCamp = "", parentAdset = "";
  if (input.dbId && input.level === "campaign") {
    const { data } = await sb.from("campaigns").select("client_id,meta_id,name,type").eq("id", input.dbId).maybeSingle();
    if (!data) return { ok: false, message: "Campaign not found" };
    clientId = data.client_id; metaId = data.meta_id; name = data.name; type = data.type;
  } else if (input.dbId && input.level === "adset") {
    const { data } = await sb.from("ad_sets").select("client_id,meta_id,name,campaign_id").eq("id", input.dbId).maybeSingle();
    if (!data) return { ok: false, message: "Ad set not found" };
    const { data: parent } = await sb.from("campaigns").select("type").eq("id", data.campaign_id).maybeSingle();
    const { data: pc } = await sb.from("campaigns").select("name").eq("id", data.campaign_id).maybeSingle();
    clientId = data.client_id; metaId = data.meta_id; name = data.name; type = (parent?.type as CampaignType) || "other"; parentCamp = pc?.name || "";
  } else {
    if (input.postId) {
      const { data } = await sb.from("posts").select("client_id,ad_meta_id,shortcode").eq("id", input.postId).maybeSingle();
      if (!data?.ad_meta_id) return { ok: false, message: "This post has no ad yet" };
      clientId = data.client_id; metaId = data.ad_meta_id; name = data.shortcode || "";
    }
    metaId = metaId.trim();
    if (!clientId || !/^\d+$/.test(metaId)) return { ok: false, message: "Missing or invalid ID" };
    // live from Meta, so brand-new items work before any sync
    try {
      const f = input.level === "ad" ? "name,campaign_id,campaign{name},adset{name,optimization_goal,destination_type}"
        : input.level === "adset" ? "name,campaign_id,campaign{name},optimization_goal,destination_type" : "name";
      const info = await graph<any>(metaId, { fields: f });
      if (!name) name = info.name || "";
      parentCamp = info.campaign?.name || ""; parentAdset = input.level === "ad" ? info.adset?.name || "" : "";
      const campMeta = input.level === "campaign" ? metaId : String(info.campaign_id || "");
      if (campMeta) {
        const { data: camp } = await sb.from("campaigns").select("type").eq("meta_id", campMeta).maybeSingle();
        if (camp?.type) type = camp.type;
      }
      if (type === "other") {
        let g = input.level === "ad" ? info.adset : info;
        if (input.level === "campaign") g = (await graph<any>(`${metaId}/adsets`, { fields: "optimization_goal,destination_type", limit: 1 })).data?.[0];
        if (g) type = /INSTAGRAM_PROFILE/i.test(g.destination_type || "") ? "visit" : typeFromGoal(g.optimization_goal);
      }
    } catch (e: any) { return { ok: false, message: String(e?.message || "Meta request failed").slice(0, 120) }; }
    if (!name) name = "Item " + metaId;
  }

  const { data: dup } = await sb.from("watch_items").select("id").eq("meta_id", metaId).eq("status", "open").maybeSingle();
  if (dup) return { ok: false, message: "Already watching this" };
  const { data: client } = await sb.from("clients").select("ad_account_id").eq("id", clientId).maybeSingle();
  if (!client) return { ok: false, message: "Client not found" };

  const today = todayStr();
  let bs = 0, br = 0;
  try { const b = await liveTotals(client.ad_account_id, input.level, metaId, addDays(today, -3), addDays(today, -1), type); bs = b.spend; br = b.results; } catch { /* no snapshot */ }

  const row = {
    client_id: clientId, level: input.level, meta_id: metaId, name, type, note: (input.note || "").trim() || null,
    started_on: today, before_spend: bs, before_results: br,
  };
  let { error } = await sb.from("watch_items").insert({ ...row, parent_camp: parentCamp, parent_adset: parentAdset });
  if (error && /parent_/.test(error.message)) ({ error } = await sb.from("watch_items").insert(row)); // SQL 016 not applied yet
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

export type Target = { key: string; name: string; sub: string; camp: string; adset: string };

const LIVE = ["ACTIVE", "IN_PROCESS", "WITH_ISSUES"];
const LIVE_ADS = ["ACTIVE", "IN_PROCESS", "PENDING_REVIEW", "PREAPPROVED", "WITH_ISSUES", "DISAPPROVED"];
const label = (s: string | null) =>
  s === "ACTIVE" ? "Active" : s === "WITH_ISSUES" || s === "DISAPPROVED" ? "Issues" : "In review";

/** Everything that is running or about to run, live from Meta (so brand-new items show up before any sync). */
export async function listTargets(clientId: string, level: WatchLevel): Promise<{ ok: boolean; message: string; items: Target[] }> {
  const sb = createServerSupabase();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return { ok: false, message: "Unauthorized", items: [] };
  const { data: client } = await sb.from("clients").select("ad_account_id").eq("id", clientId).maybeSingle();
  if (!client) return { ok: false, message: "Client not found", items: [] };
  const edge = level === "campaign" ? "campaigns" : level === "adset" ? "adsets" : "ads";
  const fields = level === "campaign" ? "name,effective_status" : level === "adset" ? "name,effective_status,campaign{name}" : "name,effective_status,adset{name},campaign{name}";
  try {
    const rows = await graphAll<any>(`act_${client.ad_account_id}/${edge}`, {
      fields, effective_status: JSON.stringify(level === "ad" ? LIVE_ADS : LIVE), limit: 100,
    }, 4);
    const items: Target[] = rows.map((a) => ({ key: String(a.id), name: a.name || "—", sub: label(a.effective_status), camp: a.campaign?.name || "", adset: a.adset?.name || "" }));
    items.sort((a, b) => a.camp.localeCompare(b.camp) || a.adset.localeCompare(b.adset) || a.name.localeCompare(b.name));
    return { ok: true, message: "", items };
  } catch (e: any) { return { ok: false, message: String(e?.message || "Meta request failed").slice(0, 120), items: [] }; }
}
