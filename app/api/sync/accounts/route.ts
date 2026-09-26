import { NextRequest, NextResponse } from "next/server";
import { assertSyncAuthorized } from "@/lib/meta/authorize-sync";
import { createAdminSupabase } from "@/lib/supabase/server";
import { syncAdAccount } from "@/lib/meta/sync";

export async function POST(request: NextRequest) {
  const unauthorized = assertSyncAuthorized(request);
  if (unauthorized) return unauthorized;

  const supabase = createAdminSupabase();
  const { data: accounts, error } = await supabase
    .from("ad_accounts")
    .select("id, meta_account_id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let synced = 0;
  for (const account of accounts ?? []) {
    await syncAdAccount(account.id, account.meta_account_id);
    synced++;
  }

  return NextResponse.json({ synced });
}
