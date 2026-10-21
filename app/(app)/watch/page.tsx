import { createServerSupabase } from "@/lib/supabase/server";
import { todayStr } from "@/lib/dates";
import { loadWatch } from "@/lib/watch";
import WatchView from "@/components/WatchView";

export const dynamic = "force-dynamic";

export default async function WatchPage({ searchParams }: { searchParams: { client?: string } }) {
  const sb = createServerSupabase();
  const [rows, { data: clients }] = await Promise.all([loadWatch(sb, todayStr(), true), sb.from("clients").select("id,name").order("name")]);
  const initial = ((clients || []) as any[]).some((c) => c.id === searchParams.client) ? String(searchParams.client) : "";
  return <WatchView key={initial} initialClient={initial} clients={(clients || []) as any[]} rows={rows} />;
}
