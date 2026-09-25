import { createAdminSupabase } from "@/lib/supabase/server";
import {
  fetchAdAccount,
  fetchAdSets,
  fetchAds,
  fetchCampaigns,
  fetchInsights,
} from "@/lib/meta/client";

const db = () => createAdminSupabase();

// أكواد account_status في Meta: 1 = ACTIVE, 2 = DISABLED, 3 = UNSETTLED, ...
function mapAccountStatus(code: number): string {
  return { 1: "active", 2: "disabled", 3: "unsettled", 7: "pending_review", 9: "in_grace_period" }[code] ?? "unknown";
}

// -----------------------------------------------------------------------
// 1) مزامنة حساب إعلاني واحد (status + بيانات أساسية)
// -----------------------------------------------------------------------
export async function syncAdAccount(adAccountRowId: string, metaAccountId: string) {
  const supabase = db();
  const remote = await fetchAdAccount(metaAccountId);

  await supabase
    .from("ad_accounts")
    .update({
      account_name: remote.name,
      currency: remote.currency,
      timezone: remote.timezone_name,
      status: mapAccountStatus(remote.account_status),
      last_sync_at: new Date().toISOString(),
    })
    .eq("id", adAccountRowId);

  // تحديث حالة العميل تلقائياً: نشط إذا كان لديه حساب واحد فعّال على الأقل
  const { data: account } = await supabase
    .from("ad_accounts")
    .select("client_id")
    .eq("id", adAccountRowId)
    .single();

  if (account?.client_id) {
    const { data: accounts } = await supabase
      .from("ad_accounts")
      .select("status")
      .eq("client_id", account.client_id);

    const hasActive = accounts?.some((a) => a.status === "active");
    await supabase
      .from("clients")
      .update({ status: hasActive ? "active" : "paused" })
      .eq("id", account.client_id);
  }
}

// -----------------------------------------------------------------------
// 2) مزامنة الحملات لحساب إعلاني معيّن
// -----------------------------------------------------------------------
export async function syncCampaigns(adAccountRowId: string, metaAccountId: string) {
  const supabase = db();
  const campaigns = await fetchCampaigns(metaAccountId);

  for (const c of campaigns) {
    await supabase.from("campaigns").upsert(
      {
        ad_account_id: adAccountRowId,
        meta_campaign_id: c.id,
        name: c.name,
        objective: c.objective,
        status: c.status,
        effective_status: c.effective_status,
        buying_type: c.buying_type,
        daily_budget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
        lifetime_budget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
        start_date: c.start_time,
        end_date: c.stop_time,
        created_time: c.created_time,
        updated_time: c.updated_time,
      },
      { onConflict: "meta_campaign_id" }
    );
  }

  return campaigns.length;
}

// -----------------------------------------------------------------------
// 3) مزامنة Ad Sets لحملة معيّنة
// -----------------------------------------------------------------------
export async function syncAdSets(campaignRowId: string, metaCampaignId: string) {
  const supabase = db();
  const adsets = await fetchAdSets(metaCampaignId);

  for (const a of adsets) {
    await supabase.from("ad_sets").upsert(
      {
        campaign_id: campaignRowId,
        meta_adset_id: a.id,
        name: a.name,
        status: a.status,
        effective_status: a.effective_status,
        optimization_goal: a.optimization_goal,
        billing_event: a.billing_event,
        bid_strategy: a.bid_strategy,
        daily_budget: a.daily_budget ? Number(a.daily_budget) / 100 : null,
        lifetime_budget: a.lifetime_budget ? Number(a.lifetime_budget) / 100 : null,
        start_date: a.start_time,
        end_date: a.end_time,
        targeting: a.targeting ?? null,
      },
      { onConflict: "meta_adset_id" }
    );
  }

  return adsets.length;
}

// -----------------------------------------------------------------------
// 4) مزامنة الإعلانات لـ Ad Set معيّن
// -----------------------------------------------------------------------
export async function syncAds(adSetRowId: string, metaAdSetId: string) {
  const supabase = db();
  const ads = await fetchAds(metaAdSetId);

  for (const ad of ads) {
    const creative = ad.creative
      ? {
          primary_text: ad.creative.body ?? null,
          headline: ad.creative.title ?? null,
          cta: ad.creative.call_to_action_type ?? null,
          image_url: ad.creative.image_url ?? null,
          thumbnail_url: ad.creative.thumbnail_url ?? null,
          video_id: ad.creative.video_id ?? null,
        }
      : null;

    await supabase.from("ads").upsert(
      {
        ad_set_id: adSetRowId,
        meta_ad_id: ad.id,
        name: ad.name,
        status: ad.status,
        effective_status: ad.effective_status,
        creative_id: ad.creative?.id ?? null,
        creative,
        created_time: ad.created_time,
        updated_time: ad.updated_time,
      },
      { onConflict: "meta_ad_id" }
    );
  }

  return ads.length;
}

// -----------------------------------------------------------------------
// 5) مزامنة الـ Insights اليومية لأي مستوى، مع دعم إعادة سحب آخر N أيام
//    لتصحيح أي attribution lag من Meta
// -----------------------------------------------------------------------
type Level = "account" | "campaign" | "adset" | "ad";

export async function syncInsights(
  level: Level,
  rowId: string,
  metaObjectId: string,
  lookbackDays = 3
) {
  const supabase = db();

  const until = new Date();
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);
  const fmt = (d: Date) => d.toISOString().split("T")[0];

  const rows = await fetchInsights(metaObjectId, fmt(since), fmt(until), level);

  for (const row of rows) {
    const linkClicks =
      row.actions?.find((a: any) => a.action_type === "link_click")?.value ?? row.inline_link_clicks ?? 0;

    // نتيجة عامة = مجموع كل الـ actions (يمكن تخصيصها لاحقاً حسب هدف الحملة)
    const resultsTotal = (row.actions ?? []).reduce(
      (sum: number, a: any) => sum + Number(a.value ?? 0),
      0
    );
    const spend = Number(row.spend ?? 0);

    const idField: Partial<Record<Level, string>> = {
      account: "ad_account_id",
      campaign: "campaign_id",
      adset: "ad_set_id",
      ad: "ad_id",
    };

    await supabase.from("daily_insights").upsert(
      {
        date: row.date_start,
        level,
        [idField[level]!]: rowId,
        spend,
        impressions: Number(row.impressions ?? 0),
        reach: Number(row.reach ?? 0),
        frequency: row.frequency ? Number(row.frequency) : null,
        clicks: Number(row.clicks ?? 0),
        link_clicks: Number(linkClicks),
        ctr: row.ctr ? Number(row.ctr) : null,
        cpc: row.cpc ? Number(row.cpc) : null,
        cpm: row.cpm ? Number(row.cpm) : null,
        results: resultsTotal || null,
        cost_per_result: resultsTotal ? spend / resultsTotal : null,
        actions: row.actions ?? null,
      },
      { onConflict: "date,level,ad_account_id,campaign_id,ad_set_id,ad_id" }
    );
  }

  return rows.length;
}
