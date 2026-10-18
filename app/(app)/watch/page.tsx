import { createServerSupabase } from "@/lib/supabase/server";
import { todayStr } from "@/lib/dates";
import { loadWatch } from "@/lib/watch";
import WatchView from "@/components/WatchView";
import { savedCid } from "@/lib/cid";

export const dynamic = "force-dynamic";

export default async function WatchPage() {
  const sb = createServerSupabase();
  const [rows, { data: clients }] = await Promise.all([loadWatch(sb, todayStr(), true), sb.from("clients").select("id,name").order("name")]);
  const initial = savedCid((clients || []) as any[]);
  return <WatchView key={initial} initialClient={initial} clients={(clients || []) as any[]} rows={rows} />;
}
