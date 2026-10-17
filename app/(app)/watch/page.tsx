import { createServerSupabase } from "@/lib/supabase/server";
import { todayStr } from "@/lib/dates";
import { loadWatch } from "@/lib/watch";
import WatchView from "@/components/WatchView";

export const dynamic = "force-dynamic";

export default async function WatchPage() {
  const sb = createServerSupabase();
  const [rows, { data: clients }] = await Promise.all([loadWatch(sb, todayStr(), true), sb.from("clients").select("id,name").order("name")]);
  return <WatchView clients={(clients || []) as any[]} rows={rows} />;
}
