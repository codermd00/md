import type { ReactNode } from "react";
import Sidebar from "@/components/Sidebar";
import { createServerSupabase } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // red dot on Overview when a watched item went bad (flag is refreshed whenever Overview / Watch loads)
  let watchAlert = false;
  try {
    const { count } = await createServerSupabase().from("watch_items").select("id", { count: "exact", head: true })
      .eq("status", "open").in("last_flag", ["stop", "worse"]);
    watchAlert = (count || 0) > 0;
  } catch { /* table may not exist yet */ }
  return (
    <div className="shell">
      <Sidebar watchAlert={watchAlert} />
      <main className="main">{children}</main>
    </div>
  );
}
