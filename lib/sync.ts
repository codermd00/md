import { createAdminSupabase } from "./supabase/server";
import { graph, graphAll, graphIds } from "./meta";
import { addDays, minDate, todayStr } from "./dates";
import { followsOf, leadsOf, resultFor, typeFromGoal, type CampaignType } from "./results";
import { previousPeriod } from "./progress";
import { syncBreakdowns } from "./sync-breakdown";
import { syncPosts } from "./sync-posts";
import { notifyEnabled, sendTelegram } from "./telegram";

const ACCOUNT_STATUS: Record<number, string> = {
  1: "active", 2: "disabled", 3: "unsettled", 7: "pending_review", 8: "pending_settlement",
  9: "grace_period", 100: "pending_closure", 101: "closed",
};

type Client = { id: string; name: string; ad_account_id: string; period_start: string | null; period_end: string | null; ig_user_id: string | null; run_posts: boolean };

const INSIGHT_FIELDS = "campaign_id,spend,impressions,clicks,reach,frequency,actions,instagram_profile_visits";
const FINAL_AFTER_DAYS = 7; // بعد انتهاء الفترة بأسبوع تُعتبر أرقامها نهائية (نافذة إسناد 7 أيام) ولا تُجلب ثانيةً

/**
 * مزامنة عميل واحد، محصورة بفترة العميل:
 *  - الحملات/المجموعات: فقط ما صرف في الفترة (أي مبلغ > 0) بغض النظر عن حالته — لا كل تاريخ الحساب
 *  - اليومي: تراكمي (آخر 7 أيام فقط بعد أول جلب)
 *  - فترة منتهية منذ أكثر من أسبوع وبياناتها محفوظة: لا جلب ثقيل
 */
export async function syncClient(clientId: string): Promise<{ ok: boolean; detail: string }> {
  const db = createAdminSupabase();
  const { data: client, error: ce } = await db.from("clients").select("*").eq("id", clientId).single();
  if (ce || !client) return { ok: false, detail: ce?.message || "Client not found" };
  const c = client as Client;
  const act = `act_${c.ad_account_id}`;
  const notes: string[] = [];

  try {
    const today = todayStr();
    const from = c.period_start || addDays(today, -(Number(today.slice(8, 10)) - 1)); // بداية الشهر إن لم تُحدد
    const to = minDate(c.period_end || today, today);

    // 0) هل أرقام هذه الفترة نهائية ومحفوظة؟ إن نعم: حالة الحساب فقط
    if (c.period_end && today > addDays(c.period_end, FINAL_AFTER_DAYS)) {
      const { data: fin } = await db.from("insights_range").select("synced_at").eq("level", "account").eq("entity_id", c.id)
        .eq("date_from", from).eq("date_to", c.period_end).limit(1);
      if (fin?.[0] && fin[0].synced_at.slice(0, 10) >= addDays(c.period_end, FINAL_AFTER_DAYS)) {
        const acc = await graph<any>(act, { fields: "account_status,currency" });
        await db.from("clients").update({
          account_status: ACCOUNT_STATUS[acc.account_status] || String(acc.account_status), currency: acc.currency, synced_at: new Date().toISOString(),
        }).eq("id", c.id);
        const pn = await syncPosts(db, c).catch((e: any) => "posts: " + (e?.message || ""));
        await db.from("sync_log").insert({ kind: "client", client_id: c.id, ok: true, detail: "Period finished and saved — skipped" + (pn ? " | " + pn : "") });
        return { ok: true, detail: "Period finished and saved" };
      }
    }

    const range = JSON.stringify({ since: from, until: to });

    // 1) بالتوازي: حالة الحساب + أرقام الفترة (حساب/حملات/مجموعات)
    const [acc, accRows, campInsAll, adsetInsAll] = await Promise.all([
      graph<any>(act, { fields: "name,account_status,currency" }),
      graphAll<any>(`${act}/insights`, { fields: "spend,impressions,clicks,reach,frequency", time_range: range }),
      graphAll<any>(`${act}/insights`, { level: "campaign", fields: INSIGHT_FIELDS, time_range: range }),
      graphAll<any>(`${act}/insights`, { level: "adset", fields: "adset_id," + INSIGHT_FIELDS, time_range: range }, 40),
    ]);

    // كيان صرف في الفترة (حتى $0.01) يُحتسب؛ صرفه 0 لا يدخل أياً كانت حالته
    const campIns = campInsAll.filter((r: any) => Number(r.spend) > 0);
    const adsetIns = adsetInsAll.filter((r: any) => Number(r.spend) > 0);

    // 2) تفاصيل الكيانات المعنية فقط (بالمعرّفات، دفعات متوازية)
    const campIds = [...new Set(campIns.map((r: any) => r.campaign_id))];
    const adsetIds = [...new Set(adsetIns.map((r: any) => r.adset_id))];
    const [campMap, adsetMap] = await Promise.all([
      graphIds<any>(campIds, "id,name,objective,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time"),
      graphIds<any>(adsetIds, "id,name,campaign_id,status,effective_status,optimization_goal,end_time"),
    ]);
    const campaigns = [...campMap.values()];
    const adsets = [...adsetMap.values()];

    // نوع الحملة = النوع الأكثر تكراراً بين مجموعاتها
    const typeVotes = new Map<string, Map<CampaignType, number>>();
    const goalOf = new Map<string, string>();
    for (const s of adsets) {
      const t = typeFromGoal(s.optimization_goal);
      const m = typeVotes.get(s.campaign_id) || new Map();
      m.set(t, (m.get(t) || 0) + 1);
      typeVotes.set(s.campaign_id, m);
      if (!goalOf.has(s.campaign_id)) goalOf.set(s.campaign_id, s.optimization_goal);
    }
    const typeOf = (id: string): CampaignType => {
      const m = typeVotes.get(id);
      if (!m) return "other";
      return [...m.entries()].filter(([t]) => t !== "other").sort((a, b) => b[1] - a[1])[0]?.[0] || "other";
    };

    const nowIso = new Date().toISOString();
    const newStatus = ACCOUNT_STATUS[acc.account_status] || String(acc.account_status);
    if (newStatus !== "active" && newStatus !== (client as any).account_status && (await notifyEnabled(db, "notify_error")))
      await sendTelegram(`🚫 Ad account problem — ${c.name}\nStatus: ${newStatus.replace(/_/g, " ")}`);
    await db.from("clients").update({ account_status: newStatus, currency: acc.currency }).eq("id", c.id);

    if (campaigns.length) {
      await db.from("campaigns").upsert(
        campaigns.map((k: any) => ({
          client_id: c.id, meta_id: k.id, name: k.name, objective: k.objective,
          optimization_goal: goalOf.get(k.id) || null, type: typeOf(k.id),
          status: k.status, effective_status: k.effective_status,
          daily_budget: k.daily_budget ? Number(k.daily_budget) / 100 : null,
          lifetime_budget: k.lifetime_budget ? Number(k.lifetime_budget) / 100 : null,
          start_time: k.start_time || null, stop_time: k.stop_time || null, synced_at: nowIso,
        })),
        { onConflict: "meta_id" }
      );
    }
    const { data: campRows } = await db.from("campaigns").select("id,meta_id,type").eq("client_id", c.id);
    const campUuid = new Map<string, { id: string; type: CampaignType }>((campRows || []).map((r: any) => [r.meta_id, { id: r.id, type: r.type }]));

    if (adsets.length) {
      const rows = adsets.filter((s: any) => campUuid.has(s.campaign_id)).map((s: any) => ({
        campaign_id: campUuid.get(s.campaign_id)!.id, client_id: c.id, meta_id: s.id, name: s.name,
        status: s.status, effective_status: s.effective_status, optimization_goal: s.optimization_goal,
        end_time: s.end_time || null, synced_at: nowIso,
      }));
      if (rows.length) await db.from("ad_sets").upsert(rows, { onConflict: "meta_id" });
    }
    const { data: asRows } = await db.from("ad_sets").select("id,meta_id").eq("client_id", c.id);
    const adsetUuid = new Map<string, string>((asRows || []).map((r: any) => [r.meta_id, r.id]));

    // 3) أرقام الفترة (رقم واحد من Meta للفترة كاملة، لا مجموع أيام)
    const out: any[] = [];
    const a = accRows[0];
    out.push({
      level: "account", entity_id: c.id, date_from: from, date_to: to,
      spend: Number(a?.spend) || 0, impressions: Number(a?.impressions) || 0, clicks: Number(a?.clicks) || 0,
      reach: Number(a?.reach) || 0, frequency: a?.frequency ? Number(a.frequency) : null, results: 0, follows: 0, result_type: null, synced_at: nowIso,
    });
    const rowOf = (level: string, entity: string, r: any, type: CampaignType) => ({
      level, entity_id: entity, date_from: from, date_to: to,
      spend: Number(r.spend) || 0, impressions: Number(r.impressions) || 0, clicks: Number(r.clicks) || 0,
      reach: Number(r.reach) || 0, frequency: r.frequency ? Number(r.frequency) : null,
      results: resultFor(type, r), follows: followsOf(r), result_type: type, synced_at: nowIso,
    });
    for (const r of campIns) {
      const k = campUuid.get(r.campaign_id);
      if (k) { out.push(rowOf("campaign", k.id, r, k.type)); }
    }
    for (const r of adsetIns) {
      const k = campUuid.get(r.campaign_id), sid = adsetUuid.get(r.adset_id);
      if (k && sid) out.push(rowOf("adset", sid, r, k.type));
    }
    const { error: upErr } = await db.from("insights_range").upsert(out, { onConflict: "level,entity_id,date_from,date_to" });
    if (upErr) throw new Error("Saving period numbers failed: " + upErr.message);
    for (const r of campIns) {
      const k = campUuid.get(r.campaign_id);
      if (k) await db.from("campaigns").update({ last_spend: Number(r.spend) || 0 }).eq("id", k.id);
    }

    // Instagram follows: separate field, needs the same attribution setup as Ads Manager (best effort)
    try {
      for (const level of ["campaign", "adset"] as const) {
        const fr = await graphAll<any>(`${act}/insights`, {
          level, fields: level === "adset" ? "campaign_id,adset_id,instagram_profile_follow" : "campaign_id,instagram_profile_follow",
          time_range: range, use_unified_attribution_setting: "true", action_attribution_windows: JSON.stringify(["1d_click", "7d_click", "1d_view"]),
        }, 40);
        for (const r of fr) {
          const n = Number(r.instagram_profile_follow) || 0;
          const ent = level === "campaign" ? campUuid.get(r.campaign_id)?.id : adsetUuid.get(r.adset_id);
          if (!n || !ent) continue;
          await db.from("insights_range").update({ follows: n }).eq("level", level).eq("entity_id", ent).eq("date_from", from).eq("date_to", to);
        }
      }
    } catch { /* follows are optional */ }

    // 4) بالتوازي: اليومي التراكمي + الفترة السابقة (مرة واحدة) + التوزيع (بمهلة ساعة)
    const dailyTask = async () => {
      const ids = [...campUuid.values()].map((k) => k.id);
      let since = from;
      if (ids.length) {
        const { data: last } = await db.from("insights_daily").select("day").eq("client_id", c.id).eq("level", "campaign")
          .gte("day", from).order("day", { ascending: false }).limit(1);
        if (last?.[0]) since = addDays(last[0].day, -7) > from ? addDays(last[0].day, -7) : from; // آخر 7 أيام فقط
      }
      const daily = await graphAll<any>(`${act}/insights`, {
        level: "campaign", fields: INSIGHT_FIELDS, time_increment: 1, time_range: JSON.stringify({ since, until: to }),
      }, 40);
      const dRows = daily.filter((r: any) => campUuid.has(r.campaign_id)).map((r: any) => {
        const k = campUuid.get(r.campaign_id)!;
        return {
          level: "campaign", entity_id: k.id, client_id: c.id, day: r.date_start,
          spend: Number(r.spend) || 0, impressions: Number(r.impressions) || 0, clicks: Number(r.clicks) || 0,
          reach: Number(r.reach) || 0, results: resultFor(k.type, r), leads: leadsOf(r), result_type: k.type,
        };
      });
      for (let i = 0; i < dRows.length; i += 500) await db.from("insights_daily").upsert(dRows.slice(i, i + 500), { onConflict: "level,entity_id,day" });
    };

    const prevTask = async () => {
      if (!c.period_start || !c.period_end) return;
      const prev = previousPeriod(c.period_start, c.period_end);
      const ids = [...campUuid.values()].map((k) => k.id);
      const { count } = ids.length
        ? await db.from("insights_range").select("id", { count: "exact", head: true }).eq("level", "campaign").eq("date_from", prev.from).in("entity_id", ids)
        : { count: 0 };
      if (count) return; // محفوظة سابقاً
      const prevRows = await graphAll<any>(`${act}/insights`, { level: "campaign", fields: INSIGHT_FIELDS, time_range: JSON.stringify({ since: prev.from, until: prev.to }) });
      const rows = prevRows.filter((r: any) => campUuid.has(r.campaign_id)).map((r: any) => {
        const k = campUuid.get(r.campaign_id)!;
        return { ...rowOf("campaign", k.id, r, k.type), date_from: prev.from, date_to: prev.to };
      });
      if (rows.length) await db.from("insights_range").upsert(rows, { onConflict: "level,entity_id,date_from,date_to" });
    };

    const bdTask = async () => {
      const bn = await syncBreakdowns(db, { act, clientId: c.id, from, to, campUuid, adsetUuid });
      if (bn) notes.push(bn);
    };

    const postsTask = async () => { const pn = await syncPosts(db, c); if (pn) notes.push(pn); };
    const settled = await Promise.allSettled([dailyTask(), prevTask(), bdTask(), postsTask()]);
    const names = ["daily", "prev", "breakdown", "posts"];
    settled.forEach((s, i) => { if (s.status === "rejected") notes.push(`${names[i]}: ${(s.reason as any)?.message || s.reason}`); });
    const dailyFailed = settled[0].status === "rejected";

    // نجاح كامل فقط يحدّث "آخر مزامنة"؛ فشل الجلب اليومي يترك الطابع القديم ويُسجَّل
    if (!dailyFailed) await db.from("clients").update({ synced_at: new Date().toISOString() }).eq("id", c.id);
    await db.from("sync_log").insert({
      kind: "client", client_id: c.id, ok: !dailyFailed,
      detail: `${campaigns.length} campaigns` + (notes.length ? " | " + notes.join(" | ") : ""),
    });
    return dailyFailed ? { ok: false, detail: notes.join(" | ") } : { ok: true, detail: `${campaigns.length} campaigns, ${adsets.length} ad sets` };
  } catch (e: any) {
    const msg = e?.message || "Unknown error";
    await db.from("sync_log").insert({ kind: "client", client_id: c.id, ok: false, detail: msg });
    return { ok: false, detail: msg };
  }
}

/** كل العملاء: 3 بالتوازي كحد أقصى */
export async function syncAll(): Promise<{ id: string; ok: boolean; detail: string }[]> {
  const db = createAdminSupabase();
  const { data } = await db.from("clients").select("id");
  const ids = (data || []).map((r: any) => r.id as string);
  const results: { id: string; ok: boolean; detail: string }[] = [];
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      results.push({ id, ...(await syncClient(id)) });
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, ids.length) }, worker));
  return results;
}
