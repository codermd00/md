import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("sync_logs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .single();

  if (error) return NextResponse.json({ status: "no_sync_yet" });
  return NextResponse.json(data);
}
