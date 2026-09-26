import { NextRequest, NextResponse } from "next/server";
import { assertSyncAuthorized } from "@/lib/meta/authorize-sync";
import { createAdminSupabase } from "@/lib/supabase/server";
import { syncAdSets } from "@/lib/meta/sync";

export async function POST(request: NextRequest) {
  const unauthorized = assertSyncAuthorized(request);
  if (unauthorized) return unauthorized;

  const campaignId = request.nextUrl.searchParams.get("campaignId"); // campaigns.id (uuid)، اختياري
  const supabase = createAdminSupabase();

  let query = supabase.from("campaigns").select("id, meta_campaign_id");
  if (campaignId) query = query.eq("id", campaignId);
  const { data: campaigns, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let total = 0;
  for (const campaign of campaigns ?? []) {
    total += await syncAdSets(campaign.id, campaign.meta_campaign_id);
  }

  return NextResponse.json({ adSetsSynced: total });
}
