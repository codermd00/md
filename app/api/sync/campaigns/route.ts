import { NextRequest, NextResponse } from "next/server";
import { assertSyncAuthorized } from "@/lib/meta/authorize-sync";
import { createAdminSupabase } from "@/lib/supabase/server";
import { syncCampaigns } from "@/lib/meta/sync";

export async function POST(request: NextRequest) {
  const unauthorized = assertSyncAuthorized(request);
  if (unauthorized) return unauthorized;

  const accountId = request.nextUrl.searchParams.get("accountId"); // ad_accounts.id (uuid)، اختياري
  const supabase = createAdminSupabase();

  let query = supabase.from("ad_accounts").select("id, meta_account_id");
  if (accountId) query = query.eq("id", accountId);
  const { data: accounts, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let total = 0;
  for (const account of accounts ?? []) {
    total += await syncCampaigns(account.id, account.meta_account_id);
  }

  return NextResponse.json({ campaignsSynced: total });
}
