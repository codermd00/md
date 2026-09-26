import { NextRequest, NextResponse } from "next/server";
import { assertSyncAuthorized } from "@/lib/meta/authorize-sync";
import { createAdminSupabase } from "@/lib/supabase/server";
import {
  syncAdAccount,
  syncAdSets,
  syncAds,
  syncCampaigns,
  syncInsights,
} from "@/lib/meta/sync";

/**
 * يشغّل التسلسل الكامل: accounts -> campaigns -> adsets -> ads -> insights
 * بالترتيب الهرمي المطلوب، ويسجّل النتيجة في sync_logs.
 * يُستدعى من: زر Manual Sync في الإعدادات، أو خدمة cron خارجية مجانية (مثل cron-job.org)
 * تستدعي هذا الرابط دورياً. يدعم GET وPOST معاً لأن أغلب خدمات الـ cron المجانية تستخدم GET.
 */
async function runFullSync(request: NextRequest) {
  const unauthorized = assertSyncAuthorized(request);
  if (unauthorized) return unauthorized;

  const supabase = createAdminSupabase();
  const { data: logRow } = await supabase
    .from("sync_logs")
    .insert({ scope: "full", status: "running" })
    .select("id")
    .single();

  let recordsSynced = 0;

  try {
    const { data: accounts } = await supabase
      .from("ad_accounts")
      .select("id, meta_account_id");

    for (const account of accounts ?? []) {
      await syncAdAccount(account.id, account.meta_account_id);
      recordsSynced++;

      await syncCampaigns(account.id, account.meta_account_id);
      await syncInsights("account", account.id, account.meta_account_id);

      const { data: campaigns } = await supabase
        .from("campaigns")
        .select("id, meta_campaign_id")
        .eq("ad_account_id", account.id);

      for (const campaign of campaigns ?? []) {
        await syncAdSets(campaign.id, campaign.meta_campaign_id);
        await syncInsights("campaign", campaign.id, campaign.meta_campaign_id);
        recordsSynced++;

        const { data: adSets } = await supabase
          .from("ad_sets")
          .select("id, meta_adset_id")
          .eq("campaign_id", campaign.id);

        for (const adSet of adSets ?? []) {
          await syncAds(adSet.id, adSet.meta_adset_id);
          await syncInsights("adset", adSet.id, adSet.meta_adset_id);
          recordsSynced++;

          const { data: ads } = await supabase
            .from("ads")
            .select("id, meta_ad_id")
            .eq("ad_set_id", adSet.id);

          for (const ad of ads ?? []) {
            await syncInsights("ad", ad.id, ad.meta_ad_id);
            recordsSynced++;
          }
        }
      }
    }

    await supabase
      .from("sync_logs")
      .update({ status: "success", finished_at: new Date().toISOString(), records_synced: recordsSynced })
      .eq("id", logRow?.id);

    return NextResponse.json({ status: "success", recordsSynced });
  } catch (err: any) {
    await supabase
      .from("sync_logs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        records_synced: recordsSynced,
        error_message: err?.message ?? String(err),
      })
      .eq("id", logRow?.id);

    return NextResponse.json({ status: "failed", error: err?.message }, { status: 500 });
  }
}

export const GET = runFullSync;
export const POST = runFullSync;
