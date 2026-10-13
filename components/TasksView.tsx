"use client";
import { useMemo, useState, useTransition } from "react";
import { deleteNote, deleteTask, saveNote, saveTask, toggleTask } from "@/app/(app)/tasks/actions";

type Task = { id: string; title: string; priority: "high" | "med" | "low"; status: "pending" | "done"; clientId: string; due: string };
type Note = { id: string; title: string; body: string; at: string };
const PRI: Record<string, { label: string; cls: string; ord: number }> = { high: { label: "عالية", cls: "bad", ord: 0 }, med: { label: "متوسطة", cls: "warn", ord: 1 }, low: { label: "منخفضة", cls: "mute", ord: 2 } };
const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);

export default function TasksView({ clients, tasks, notes }: { clients: { id: string; name: string }[]; tasks: Task[]; notes: Note[] }) {
  const [q, setQ] = useState("");
  const [flt, setFlt] = useState<"pending" | "done" | "all">("pending");
  const [client, setClient] = useState("");
  const [te, setTe] = useState<Partial<Task> | null>(null);
  const [ne, setNe] = useState<Partial<Note> | null>(null);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const name = (id: string) => clients.find((c) => c.id === id)?.name || "";
  const has = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());

  const shownT = useMemo(() => tasks
    .filter((t) => (flt === "all" || t.status === flt) && (!client || t.clientId === client) && has(t.title + " " + name(t.clientId)))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "done" ? 1 : -1) || PRI[a.priority].ord - PRI[b.priority].ord || (a.due || "9").localeCompare(b.due || "9")),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [tasks, flt, client, q]);
  const shownN = notes.filter((n) => has(n.title + " " + n.body));
  const left = tasks.filter((t) => t.status === "pending").length;

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) => start(async () => { const r = await fn(); if (!r.ok) setMsg(r.message || "خطأ"); else { setMsg(""); after?.(); } });

  return (
    <>
      <div className="topbar" style={{ marginBottom: 14 }}>
        <div><div className="h1" style={{ fontSize: 20 }}>Tasks & Notes</div><div className="sub">{left} / {notes.length}</div></div>
        <div className="pbar">
          <input placeholder="بحث" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 150, padding: "7px 10px", fontSize: 13 }} />
          <select value={client} onChange={(e) => setClient(e.target.value)}><option value="">كل العملاء</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <button className="btn pri" onClick={() => setTe({ priority: "med", title: "", clientId: "", due: "" })}>+ Add Task</button>
          <button className="btn" onClick={() => setNe({ title: "", body: "" })}>+ Add Note</button>
        </div>
      </div>
      {msg && <div className="msg err">{msg}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(320px,100%),1fr))", gap: 16, alignItems: "start" }}>
        {/* RTL: الأول يمين = الملاحظات، الثاني يسار = المهام */}
        <div className="panel">
          <h3>Notes</h3>
          {shownN.length === 0 ? <div className="empty" style={{ padding: 20 }}><b>No notes</b></div> :
            shownN.map((n) => (
              <div key={n.id} className="dsum" style={{ display: "block", cursor: "pointer", padding: "10px 0", borderTop: "1px solid var(--border)" }} onClick={() => setNe(n)}>
                {n.title && <b style={{ display: "block", fontSize: 13 }}>{n.title}</b>}
                <span dir="auto" style={{ fontSize: 12.5, color: "var(--t2)", whiteSpace: "pre-wrap" }}>{n.body.slice(0, 220)}{n.body.length > 220 ? "…" : ""}</span>
                <div className="sub" style={{ margin: "4px 0 0" }}>{n.at.slice(0, 10)}</div>
              </div>
            ))}
        </div>

        <div className="panel">
          <h3>Tasks</h3>
          <div className="btabs">
            {([["pending", "Pending"], ["done", "Done"], ["all", "All"]] as const).map(([k, l]) => <span key={k} className={`btab ${flt === k ? "on" : ""}`} onClick={() => setFlt(k)}>{l}</span>)}
          </div>
          {shownT.length === 0 ? <div className="empty" style={{ padding: 20 }}><b>No tasks</b></div> :
            shownT.map((t) => {
              const late = t.status === "pending" && t.due && t.due < today();
              return (
                <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 0", borderTop: "1px solid var(--border)", opacity: t.status === "done" ? 0.55 : 1 }}>
                  <input type="checkbox" style={{ width: 18, height: 18, flex: "none" }} checked={t.status === "done"} disabled={pending} onChange={(e) => run(() => toggleTask(t.id, e.target.checked))} />
                  <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => setTe(t)}>
                    <div dir="auto" style={{ fontSize: 13.5, fontWeight: 600, textDecoration: t.status === "done" ? "line-through" : "none" }}>{t.title}</div>
                    <div className="sub" style={{ margin: 0 }}>{[name(t.clientId), t.due && (late ? "⚠ " : "") + t.due].filter(Boolean).join(" · ")}</div>
                  </div>
                  <span className={`chip sm ${PRI[t.priority].cls}`}>{PRI[t.priority].label}</span>
                </div>
              );
            })}
        </div>
      </div>

      {te && (
        <div className="overlay" onClick={() => !pending && setTe(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{te.id ? "تعديل مهمة" : "مهمة جديدة"}</h2>
            <div className="grid g2">
              <label className="f" style={{ gridColumn: "1 / -1" }}>العنوان<input value={te.title || ""} onChange={(e) => setTe({ ...te, title: e.target.value })} autoFocus /></label>
              <label className="f">الأولوية<select value={te.priority} onChange={(e) => setTe({ ...te, priority: e.target.value as any })}><option value="high">عالية</option><option value="med">متوسطة</option><option value="low">منخفضة</option></select></label>
              <label className="f">الموعد (اختياري)<input type="date" value={te.due || ""} onChange={(e) => setTe({ ...te, due: e.target.value })} /></label>
              <label className="f" style={{ gridColumn: "1 / -1" }}>العميل (اختياري)<select value={te.clientId || ""} onChange={(e) => setTe({ ...te, clientId: e.target.value })}><option value="">— بدون —</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            </div>
            <div className="acts">
              {te.id && <button className="btn" style={{ marginInlineEnd: "auto", color: "var(--red)" }} disabled={pending} onClick={() => confirm("حذف المهمة؟") && run(() => deleteTask(te.id!), () => setTe(null))}>حذف</button>}
              <button className="btn" onClick={() => setTe(null)} disabled={pending}>إلغاء</button>
              <button className="btn pri" disabled={pending} onClick={() => run(() => saveTask({ id: te.id, title: te.title || "", priority: te.priority || "med", client_id: te.clientId || "", due_date: te.due || "" }), () => setTe(null))}>{pending ? "..." : "حفظ"}</button>
            </div>
          </div>
        </div>
      )}

      {ne && (
        <div className="overlay" onClick={() => !pending && setNe(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{ne.id ? "تعديل ملاحظة" : "ملاحظة جديدة"}</h2>
            <div className="grid">
              <label className="f">العنوان (اختياري)<input value={ne.title || ""} onChange={(e) => setNe({ ...ne, title: e.target.value })} /></label>
              <label className="f">النص<textarea rows={8} dir="auto" value={ne.body || ""} onChange={(e) => setNe({ ...ne, body: e.target.value })} autoFocus /></label>
            </div>
            <div className="acts">
              {ne.id && <button className="btn" style={{ marginInlineEnd: "auto", color: "var(--red)" }} disabled={pending} onClick={() => confirm("حذف الملاحظة؟") && run(() => deleteNote(ne.id!), () => setNe(null))}>حذف</button>}
              <button className="btn" onClick={() => setNe(null)} disabled={pending}>إلغاء</button>
              <button className="btn pri" disabled={pending} onClick={() => run(() => saveNote({ id: ne.id, title: ne.title || "", body: ne.body || "" }), () => setNe(null))}>{pending ? "..." : "حفظ"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
