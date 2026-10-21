import { createServerSupabase } from "@/lib/supabase/server";
import TasksView from "@/components/TasksView";

export const dynamic = "force-dynamic";

export default async function TasksPage({ searchParams }: { searchParams: { client?: string } }) {
  const sb = createServerSupabase();
  const [{ data: tasks }, { data: notes }, { data: clients }] = await Promise.all([
    sb.from("tasks").select("id,title,priority,status,client_id,due_date,created_at").order("created_at", { ascending: false }).limit(500),
    sb.from("notes").select("id,title,body,created_at").order("created_at", { ascending: false }).limit(500),
    sb.from("clients").select("id,name").order("name"),
  ]);
  const initial = ((clients || []) as any[]).some((c) => c.id === searchParams.client) ? String(searchParams.client) : "";
  return (
    <TasksView
      key={initial}
      initialClient={initial}
      clients={(clients || []) as any[]}
      tasks={(tasks || []).map((t: any) => ({ id: t.id, title: t.title, priority: t.priority, status: t.status, clientId: t.client_id || "", due: t.due_date || "" }))}
      notes={(notes || []).map((n: any) => ({ id: n.id, title: n.title || "", body: n.body || "", at: n.created_at }))}
    />
  );
}
