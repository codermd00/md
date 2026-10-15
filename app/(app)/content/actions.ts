"use server";
import { revalidatePath } from "next/cache";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { graph, graphAll, graphPost } from "@/lib/meta";
import { notifyEnabled, sendTelegram } from "@/lib/telegram";
import { syncPosts } from "@/lib/sync-posts";

async function requireUser() {
  const sb = createServerSupabase();
  const { data } = await sb.auth.getUser();
  if (!data.user) throw new Error("Unauthorized");
  return sb;
}

/** تحديث المنشورات الآن (عميل واحد أو الكل) */
export async function refreshPosts(clientId?: string, count?: number): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  const db = createAdminSupabase();
  const q = db.from("clients").select("id,name,ig_user_id,run_posts");
  const { data } = clientId ? await q.eq("id", clientId) : await q;
  const notes: string[] = [];
  for (const c of (data || []) as any[]) {
    const n = await syncPosts(db, c, count ? { limit: count, force: true } : undefined).catch((e: any) => "posts: " + (e?.message || ""));
    if (n) notes.push(`${c.name}: ${n}`);
  }
  revalidatePath("/content");
  return notes.length ? { ok: false, message: notes.join(" | ") } : { ok: true, message: "Updated" };
}

export type TargetAdSet = { id: string; name: string; status: string; goal: string };
export type TargetCampaign = { id: string; name: string; status: string; adsets: TargetAdSet[] };

const GOALS = new Set(["REACH", "POST_ENGAGEMENT", "IMPRESSIONS", "VISIT_INSTAGRAM_PROFILE"]);

/** حملات (وصول/تفاعل/زيارة بروفايل) ومجموعاتها من Meta مباشرة — تُجلب عند فتح نافذة المنشور */
export async function listTargets(clientId: string): Promise<{ ok: boolean; message: string; campaigns: TargetCampaign[] }> {
  const sb = await requireUser();
  const { data: c } = await sb.from("clients").select("ad_account_id,period_start").eq("id", clientId).single();
  if (!c) return { ok: false, message: "Client not found", campaigns: [] };
  try {
    const filter = JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "WITH_ISSUES", "IN_PROCESS"] }]);
    const adsets = await graphAll<any>(`act_${c.ad_account_id}/adsets`, {
      fields: "id,name,effective_status,optimization_goal,destination_type,updated_time,created_time,campaign{id,name,effective_status}", filtering: filter,
    }, 10);
    // ضمن فترة العميل فقط: ما صرف فيها (من قاعدتنا) أو النشط الآن أو ما تغيّر/أُنشئ منذ بداية الفترة
    const since = c.period_start ? new Date(c.period_start + "T00:00:00+03:00").getTime() : Date.now() - 31 * 864e5;
    const { data: dbSets } = await sb.from("ad_sets").select("meta_id").eq("client_id", clientId);
    const spent = new Set((dbSets || []).map((x: any) => String(x.meta_id)));
    const byCamp = new Map<string, TargetCampaign>();
    for (const s of adsets) {
      const goal = String(s.optimization_goal);
      const okGoal = GOALS.has(goal) || /PROFILE|VISIT/.test(goal) || String(s.destination_type) === "INSTAGRAM_PROFILE";
      if (!okGoal || !s.campaign?.id) continue;
      const recent = Math.max(Date.parse(s.updated_time || "") || 0, Date.parse(s.created_time || "") || 0) >= since;
      if (!(s.effective_status === "ACTIVE" || spent.has(String(s.id)) || recent)) continue;
      const k: TargetCampaign = byCamp.get(s.campaign.id) || { id: s.campaign.id, name: s.campaign.name, status: s.campaign.effective_status, adsets: [] };
      k.adsets.push({ id: s.id, name: s.name, status: s.effective_status, goal: s.optimization_goal });
      byCamp.set(s.campaign.id, k);
    }
    const list = [...byCamp.values()].sort((a, b) => (a.status === "ACTIVE" ? 0 : 1) - (b.status === "ACTIVE" ? 0 : 1) || a.name.localeCompare(b.name));
    return { ok: true, message: list.length ? "" : "No reach, engagement or profile visit campaigns in this account", campaigns: list };
  } catch (e: any) {
    return { ok: false, message: e?.message || "Meta fetch failed", campaigns: [] };
  }
}

export type PostInput = {
  id: string; status: "ready" | "skip"; mode: "direct" | "copy" | "";
  budget: string; days: string;
  meta_campaign_id: string; meta_campaign_name: string; meta_adset_id: string; meta_adset_name: string;
};

export async function savePost(i: PostInput): Promise<{ ok: boolean; message: string }> {
  const sb = await requireUser();
  const budget = i.budget.trim() === "" ? null : Number(i.budget);
  const days = i.days.trim() === "" ? null : Math.round(Number(i.days));
  if (i.mode === "copy" && (!(budget && budget > 0) || !(days && days > 0))) return { ok: false, message: "Copy mode needs budget and days" };
  if (i.mode && !i.meta_adset_id) return { ok: false, message: "Select an ad set" };
  const { error } = await sb.from("posts").update({
    status: i.status, mode: i.mode || null, budget, days,
    meta_campaign_id: i.meta_campaign_id || null, meta_campaign_name: i.meta_campaign_name || null,
    meta_adset_id: i.meta_adset_id || null, meta_adset_name: i.meta_adset_name || null,
  }).eq("id", i.id);
  revalidatePath("/content");
  return error ? { ok: false, message: error.message } : { ok: true, message: "Saved" };
}

/** حذف = إخفاء (لا يعود عند الجلب القادم) */
export async function hidePost(id: string): Promise<{ ok: boolean }> {
  const sb = await requireUser();
  const { error } = await sb.from("posts").update({ hidden: true }).eq("id", id);
  revalidatePath("/content");
  return { ok: !error };
}

// ───────────────────────── Run (6b) ─────────────────────────

const ZERO_DEC = new Set(["IQD", "JPY", "KRW", "VND", "CLP", "PYG", "UGX", "XAF", "XOF", "ISK", "HUF", "TWD"]);
const minor = (amount: number, cur: string) => Math.round(amount * (ZERO_DEC.has(cur) ? 1 : 100));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function dayHours(db: any): Promise<number> {
  const { data } = await db.from("settings").select("value").eq("key", "day_hours").maybeSingle();
  return Number(data?.value) || 18;
}

async function loadRun(db: any, id: string) {
  const { data: p } = await db.from("posts").select("*").eq("id", id).maybeSingle();
  if (!p) return { err: "Post not found" } as const;
  const { data: c } = await db.from("clients").select("id,name,ad_account_id,page_id,ig_user_id").eq("id", p.client_id).maybeSingle();
  if (!c) return { err: "Client not found" } as const;
  return { p, c } as const;
}

function validate(p: any, c: any): string {
  if (p.status !== "ready") return "Post is not Ready";
  if (p.eligible === false) return "Check ✗ — Meta will not boost this post";
  if (!p.mode) return "Select a method";
  if (!p.meta_adset_id) return "Select an ad set";
  if (!c.page_id) return "Client has no Page ID (edit in Clients)";
  if (!c.ig_user_id) return "Client has no Instagram ID";
  if (p.mode === "copy" && (!(Number(p.budget) > 0) || !(Number(p.days) > 0))) return "Copy mode needs budget and days";
  return "";
}

/** معاينة قبل التشغيل — لا تغيّر شيئاً في Meta */
export async function previewRun(id: string): Promise<{ ok: boolean; message: string; lines: string[] }> {
  await requireUser();
  const db = createAdminSupabase();
  const r = await loadRun(db, id);
  if ("err" in r) return { ok: false, message: String(r.err), lines: [] };
  const { p, c } = r;
  const bad = validate(p, c);
  if (bad) return { ok: false, message: bad, lines: [] };
  const lines = [`Client: ${c.name}`, `Post: ${p.shortcode} (${p.media_type})`, `Campaign: ${p.meta_campaign_name || p.meta_campaign_id}`];
  if (p.mode === "direct") {
    lines.push(`Method: add ad directly to ad set "${p.meta_adset_name}"`, "Ad set budget and schedule stay unchanged.");
  } else {
    const h = await dayHours(db);
    const end = new Date(Date.now() + Number(p.days) * h * 3600e3);
    lines.push(`Method: copy ad set "${p.meta_adset_name}" and run it`, `Total budget: ${p.budget}`, `Duration: ${p.days} day(s) × ${h}h`,
      `Ends: ${end.toLocaleString("en-GB", { timeZone: "Asia/Baghdad" })} (Baghdad)`);
  }
  lines.push("The ad will be created ACTIVE and start spending immediately.");
  return { ok: true, message: "", lines };
}

async function step(db: any, postId: string, name: string, ok: boolean, detail?: string) {
  await db.from("post_runs").insert({ post_id: postId, step: name, ok, detail: detail ? detail.slice(0, 500) : null });
}

/** تشغيل المنشور كإعلان. يمنع التكرار بقفل ذرّي (ready → running). */
export async function runPost(id: string): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  const db = createAdminSupabase();
  const r = await loadRun(db, id);
  if ("err" in r) return { ok: false, message: String(r.err) };
  const { p, c } = r;
  const bad = validate(p, c);
  if (bad) return { ok: false, message: bad };

  // قفل: ينجح مرة واحدة فقط
  const { data: lock } = await db.from("posts").update({ status: "running", error: null, run_at: new Date().toISOString() }).eq("id", id).eq("status", "ready").select("id");
  if (!lock?.length) return { ok: false, message: "Post is already running or was run" };

  const notifyErr = async (msg: string) => { if (await notifyEnabled(db, "notify_error")) await sendTelegram(`❌ Run failed — ${c.name} / ${p.shortcode}\n${msg}`); };
  const fail = async (stepName: string, msg: string, notice?: string) => {
    await step(db, id, stepName, false, msg);
    await db.from("posts").update({ status: "failed", error: `${stepName}: ${msg}`.slice(0, 500) }).eq("id", id);
    await notifyErr(notice || msg);
    revalidatePath("/content");
    return { ok: false, message: `${stepName}: ${msg}` };
  };

  // 1) تأكد أن المنشور ما زال موجوداً
  try { await graph(p.ig_media_id, { fields: "id,shortcode" }); await step(db, id, "verify", true); }
  catch (e: any) { return fail("verify", e?.message || "", "Post Deleted or Not Found"); }

  let adsetId: string = p.meta_adset_id;
  let endIso: string | null = null;
  try {
    // 2) وضع النسخ
    if (p.mode === "copy") {
      const { data: acct } = await db.from("clients").select("currency").eq("id", c.id).maybeSingle();
      const cur = String((acct as any)?.currency || "USD").toUpperCase();
      let src: any = {};
      try {
        src = await graph(p.meta_adset_id, { fields: "name,campaign_id,daily_budget,lifetime_budget,targeting,optimization_goal,billing_event,bid_strategy,bid_amount,promoted_object,destination_type,pacing_type,attribution_spec" });
      } catch {}
      // Meta still requires "explore" next to "explore_home" in Instagram positions
      const fixTargeting = (t: any) => {
        if (!t) return null;
        const pos: string[] = t.instagram_positions || [];
        if (pos.includes("explore_home") && !pos.includes("explore")) return { ...t, instagram_positions: [...pos, "explore"] };
        return null;
      };
      const fixed = fixTargeting(src.targeting);
      const h = await dayHours(db);
      endIso = new Date(Date.now() + Number(p.days) * h * 3600e3).toISOString();
      const upd: Record<string, any> = { name: p.shortcode, lifetime_budget: minor(Number(p.budget), cur), end_time: endIso, status: "ACTIVE" };
      if (src.daily_budget && Number(src.daily_budget) > 0) upd.daily_budget = 0;
      if (fixed) upd.targeting = fixed;
      let copied = "";
      try {
        const copy = await graphPost<any>(`${p.meta_adset_id}/copies`, { deep_copy: false, status_option: "PAUSED" });
        copied = String(copy.copied_adset_id || copy.ad_object_ids?.[0]?.copied_id || "");
        if (!copied) throw new Error("Meta returned no copy ID");
      } catch (e: any) {
        // source ad set fails Meta's validation: build the new ad set from its settings instead
        if (!/explore/i.test(e?.message || "") || !src.campaign_id) throw e;
        const body: Record<string, any> = {
          name: p.shortcode, campaign_id: src.campaign_id, targeting: fixed || src.targeting, optimization_goal: src.optimization_goal,
          billing_event: src.billing_event, bid_strategy: src.bid_strategy, bid_amount: src.bid_amount, promoted_object: src.promoted_object,
          destination_type: src.destination_type, pacing_type: src.pacing_type, attribution_spec: src.attribution_spec,
          lifetime_budget: upd.lifetime_budget, end_time: endIso, status: "ACTIVE",
        };
        for (const k of Object.keys(body)) if (body[k] === undefined || body[k] === null) delete body[k];
        const made = await graphPost<any>(`act_${c.ad_account_id}/adsets`, body);
        adsetId = String(made.id);
        await step(db, id, "create_adset", true, adsetId);
      }
      if (copied) {
        adsetId = copied;
        await step(db, id, "copy", true, adsetId);
        await sleep(10000);
        await graphPost(adsetId, upd);
      }
      await step(db, id, "edit_adset", true, `budget ${p.budget} · ${p.days}d`);
    }
  } catch (e: any) { return fail(p.mode === "copy" ? "copy" : "adset", e?.message || ""); }

  // 3) الكرييتف ثم الإعلان
  let creativeId = "";
  try {
    const cr = await graphPost<any>(`act_${c.ad_account_id}/adcreatives`, {
      name: p.shortcode, object_id: c.page_id, instagram_user_id: c.ig_user_id, source_instagram_media_id: p.ig_media_id,
      call_to_action: { type: "VIEW_INSTAGRAM_PROFILE", value: { link: `https://www.instagram.com/${p.username}/` } },
    });
    creativeId = String(cr.id);
    await step(db, id, "creative", true, creativeId);
  } catch (e: any) { return fail("creative", e?.message || ""); }

  try {
    const ad = await graphPost<any>(`act_${c.ad_account_id}/ads`, { name: p.shortcode, adset_id: adsetId, creative: { creative_id: creativeId }, status: "ACTIVE" });
    await step(db, id, "ad", true, String(ad.id));
    await db.from("posts").update({
      status: p.mode === "copy" ? "running" : "done", ad_meta_id: String(ad.id), run_adset_id: adsetId, run_end_time: endIso, error: null,
    }).eq("id", id);
    if (await notifyEnabled(db, "notify_run_done")) {
      await sendTelegram(`✅ Ad created — ${c.name}\n${p.shortcode} → ${p.mode === "copy" ? `new ad set (${p.budget}, ${p.days}d)` : p.meta_adset_name}`);
    }
    revalidatePath("/content");
    return { ok: true, message: "Ad created" };
  } catch (e: any) { return fail("ad", e?.message || ""); }
}

/** إعادة منشور فاشل إلى Ready لإعادة المحاولة (إن كان قد أنشأ نسخة فيجب حذفها يدوياً من Meta) */
export async function resetPost(id: string): Promise<{ ok: boolean }> {
  const sb = await requireUser();
  const { error } = await sb.from("posts").update({ status: "ready", error: null }).eq("id", id).eq("status", "failed");
  revalidatePath("/content");
  return { ok: !error };
}

/** نسخة جديدة من نفس المنشور (لتشغيله مرة أخرى على حملة أخرى) — تبقى الأولى كما هي */
export async function duplicatePost(id: string): Promise<{ ok: boolean; message: string }> {
  const sb = await requireUser();
  const { data: p } = await sb.from("posts").select("*").eq("id", id).maybeSingle();
  if (!p) return { ok: false, message: "Post not found" };
  const { error } = await sb.from("posts").insert({
    client_id: p.client_id, ig_media_id: p.ig_media_id, shortcode: p.shortcode, permalink: p.permalink, media_type: p.media_type,
    caption: p.caption, username: p.username, thumb_path: p.thumb_path, posted_at: p.posted_at, eligible: p.eligible, ineligible_reason: p.ineligible_reason,
    status: "ready", budget: p.budget, days: p.days, copy_of: p.copy_of || p.id,
  });
  revalidatePath("/content");
  return error ? { ok: false, message: error.message } : { ok: true, message: "New copy added as Ready" };
}
