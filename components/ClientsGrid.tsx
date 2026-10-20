"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { deleteClient, syncNow, type ClientInput } from "@/app/(app)/clients/actions";
import ClientForm, { EMPTY_CLIENT } from "./ClientForm";

export type ClientCard = {
  id: string; name: string; ig_username: string | null; ad_account_id: string;
  period_start: string | null; period_end: string | null; budget: number;
  business_type: string | null; city: string | null; page_id: string | null; ig_user_id: string | null; run_posts: boolean;
  alert_messages: string; alert_engagement: string; alert_reach: string; alert_visit: string; alert_leads: string; alert_thruplay: string;
  account_status: string | null; spend: number; daysLeft: number | null; synced_at: string | null;
};

const money = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });

function statusOf(c: ClientCard): { key: string; label: string; cls: string } {
  if (c.period_end && c.daysLeft === 0) return { key: "finished", label: "Finished", cls: "mute" };
  if (c.account_status === "active") return { key: "live", label: "Live", cls: "ok" };
  if (!c.account_status) return { key: "unknown", label: "Not synced", cls: "warn" };
  if (c.account_status === "disabled") return { key: "disabled", label: "Disabled", cls: "bad" };
  return { key: "other", label: c.account_status, cls: "warn" };
}

export default function ClientsGrid({ clients }: { clients: ClientCard[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState<ClientInput | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return clients.filter((c) => {
      if (filter !== "all" && statusOf(c).key !== filter) return false;
      return !s || [c.name, c.ig_username, c.ad_account_id, c.city].some((v) => (v || "").toLowerCase().includes(s));
    });
  }, [clients, q, filter]);

  function edit(c: ClientCard) {
    setForm({
      id: c.id, name: c.name, ig_username: c.ig_username || "", ad_account_id: c.ad_account_id,
      period_start: c.period_start || "", period_end: c.period_end || "", budget: String(c.budget || ""),
      business_type: c.business_type || "", city: c.city || "",
      page_id: c.page_id || "", ig_user_id: c.ig_user_id || "", run_posts: c.run_posts,
      alert_messages: c.alert_messages, alert_engagement: c.alert_engagement, alert_reach: c.alert_reach, alert_visit: c.alert_visit, alert_leads: c.alert_leads, alert_thruplay: c.alert_thruplay,
    });
  }
  function remove(c: ClientCard) {
    if (!confirm(`Delete ${c.name} and all its data?`)) return;
    start(async () => { const r = await deleteClient(c.id); setMsg({ ok: r.ok, text: r.message }); });
  }
  const [busyId, setBusyId] = useState<string | null>(null);
  function syncOne(c: ClientCard) {
    setBusyId(c.id); setMsg(null);
    start(async () => { const r = await syncNow(c.id); setMsg({ ok: r.ok, text: `${c.name}: ${r.ok ? "Synced" : r.message}` }); setBusyId(null); });
  }
  function syncAllNow() {
    start(async () => { const r = await syncNow(); setMsg({ ok: r.ok, text: r.message }); });
  }

  return (
    <>
      <div className="topbar">
        <div><div className="h1">Clients</div><div className="sub">{clients.length}</div></div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn" onClick={syncAllNow} disabled={pending}>{pending ? "..." : "Sync now"}</button>
          <button className="btn pri" onClick={() => setForm({ ...EMPTY_CLIENT })}>+ Add Client</button>
        </div>
      </div>

      <div className="toolbar">
        <input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All status</option><option value="live">Live</option>
          <option value="disabled">Disabled</option><option value="finished">Finished</option>
        </select>
        {msg && <span className={`msg ${msg.ok ? "" : "err"}`} style={{ margin: 0 }}>{msg.text}</span>}
      </div>

      {clients.length === 0 ? (
        <div className="card empty"><b>No clients yet</b>Click Add Client.</div>
      ) : list.length === 0 ? (
        <div className="card empty"><b>No results</b></div>
      ) : (
        <div className="cards">
          {list.map((c) => {
            const st = statusOf(c);
            const pct = c.budget > 0 ? Math.min(100, (c.spend / c.budget) * 100) : 0;
            const over = c.budget > 0 && c.spend > c.budget;
            return (
              <div className="cc" key={c.id}>
                <div className="cc-h">
                  <div className="av">{c.name.charAt(0).toUpperCase()}</div>
                  <div className="t">
                    <Link href={`/clients/${c.id}`}><b>{c.name}</b></Link>
                    <span>{[c.business_type, c.city].filter(Boolean).join(" · ") || (c.ig_username ? "@" + c.ig_username : "—")}</span>
                  </div>
                  <button className="ib" title="Sync this client" onClick={() => syncOne(c)} disabled={pending} style={busyId === c.id ? { opacity: 0.5 } : undefined}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 01-15.5 6.2M3 12A9 9 0 0118.5 5.8M18.5 2v4h-4M5.5 22v-4h4" /></svg>
                  </button>
                  <button className="ib" title="Edit" onClick={() => edit(c)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>
                  </button>
                  <button className="ib del" title="Delete" onClick={() => remove(c)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                  </button>
                </div>
                <div className="stats">
                  <div className="stat"><small>Budget</small><b>{money(c.budget)}</b></div>
                  <div className="stat"><small>Spend</small><b style={over ? { color: "var(--red)" } : undefined}>{money(c.spend)}</b></div>
                  <div className="stat"><small>Camp. end</small><b>{c.daysLeft === null ? "—" : `${c.daysLeft}d`}</b></div>
                </div>
                <div>
                  <div className="pl"><span>Spend progress</span><span>{c.budget > 0 ? `${Math.round((c.spend / c.budget) * 100)}%` : "—"}</span></div>
                  <div className={`bar ${over ? "over" : ""}`}><i style={{ width: `${pct}%` }} /></div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className={`chip ${st.cls}`}>{st.label}</span>
                  <span className="sub" style={{ margin: 0 }}>{c.ig_username ? "@" + c.ig_username : ""}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {form && <ClientForm initial={form} onClose={() => setForm(null)} onDone={(r) => setMsg({ ok: r.ok, text: r.message })} />}
    </>
  );
}
