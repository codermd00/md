import type { ReactNode } from "react";
import Sidebar from "@/components/Sidebar";
import { createServerSupabase } from "@/lib/supabase/server";
import { savedCid } from "@/lib/cid";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { data } = await createServerSupabase().from("clients").select("id,name").order("name");
  const clients = ((data as any[]) || []).map((c) => ({ id: c.id as string, name: c.name as string }));
  return (
    <div className="shell">
      <Sidebar clients={clients} initialClient={savedCid(clients)} />
      <main className="main">{children}</main>
    </div>
  );
}
