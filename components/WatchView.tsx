"use client";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { addWatch, closeWatch, deleteWatch, listTargets, type Target } from "@/app/(app)/watch/actions";
import type { WatchRow } from "@/lib/watch";
import { FLAG_COLOR, FLAG_TEXT, LEVEL } from "./WatchLine";
import { writeCid } from "@/lib/cid-client";

const money = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const LEVELS = [["campaign", "Campaign"], ["adset", "Ad set"], ["ad", "Ad"]] as const;

export default function WatchView({ clients, rows, initialClient = "" }: { clients: { id: string; name: string }[]; rows: WatchRow[]; initialClient?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [closing, setClosing] = useState<WatchRow | null>(null);
  const [closeNote, setCloseNote] = useState("");
  const [showClosed, setShowClosed] = useState(false);

  const [cid, setCid] = useState(clients[0]?.id || "");
  const [lvl, setLvl] = useState<"campaign" | "adset" | "ad">("campaign");
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!adding || !cid) return;
    let alive = true;
    setLoading(true); setMsg(""); setTargets([]);
    listTargets(cid, lvl).then((r) => { if (!alive) return; setTargets(r.items); if (!r.ok) setMsg(r.message); setLoading(false); })
      .catch(() => { if (alive) { setMsg("Request failed"); setLoading(false); } });
    return () => { alive = false; };
  }, [adding, cid, lvl]);

  const [fc, setFc] = useState(initialClient);
  const [sort, setSort] = useState<"status" | "campaign">("status");
  const clientsWith = clients.filter((c) => rows.some((r) => r.clientId === c.id));
  const open = rows.filter((r) => r.status === "open" && (!fc || r.clientId === fc));
  const closed = rows.filter((r) => r.status === "closed" && (!fc || r.clientId === fc));
  const shown = targets.filter((t) => !q || (t.name + " " + t.camp + " " + t.adset).toLowerCase().includes(q.toLowerCase()));

  const add = (t: Target) => start(async () => {
    const r = await addWatch({ level: lvl, clientId: cid, metaId: t.key, name: t.name, note });
    setMsg(r.message);
    if (r.ok) { setAdding(false); setNote(""); setQ(""); router.refresh(); }
  });

  const path = (r: WatchRow) => (r.parentCamp ? `${r.parentCamp}${r.parentAdset ? " › " + r.parentAdset : ""}` : "");
  const line = (r: WatchRow) => (
    <tr key={r.id}>
      <td>
        <span className="wdotl" style={{ background: FLAG_COLOR[r.flag] }} /><b>{r.name}</b>
        {path(r) && <div className="sub" style={{ margin: "2px 0 0 15px" }} dir="auto">{path(r)}</div>}
        {r.note && <div className="sub" style={{ margin: "2px 0 0 15px", fontStyle: "italic" }} dir="auto">{r.note}</div>}
      </td>
      <td>{LEVEL[r.level]}</td>
      <td>{r.days}d</td>
      <td>{r.before}</td>
      <td><b style={{ color: FLAG_COLOR[r.flag] }}>{r.cost}</b></td>
      <td>{money(r.spend)}</td>
      <td>{Math.round(r.results).toLocaleString("en-US")}</td>
      <td><span style={{ color: FLAG_COLOR[r.flag] }}>{r.error ? "Meta error" : FLAG_TEXT[r.flag]}</span></td>
      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        {r.status === "open" && <a style={{ color: "var(--blue2)", fontWeight: 600, cursor: "pointer" }} onClick={() => { setClosing(r); setCloseNote(""); }}>Close</a>}
        {r.status === "closed" && <span className="sub" style={{ margin: 0 }}>{r.closedOn}</span>}
        <a style={{ color: "var(--red)", cursor: "pointer", marginLeft: 12 }} onClick={() => { if (confirm(`Delete "${r.name}"?`)) start(async () => { await deleteWatch(r.id); router.refresh(); }); }}>Delete</a>
      </td>
    </tr>
  );
  const head = (
    <thead><tr><th>Item</th><th>Type</th><th>Days</th><th>Before</th><th>Now</th><th>Spend</th><th>Results</th><th>Status</th><th /></tr></thead>
  );

  // One section per client, worst clients first; inside a client either by status or by campaign
  const RANK: Record<WatchRow["flag"], number> = { stop: 0, worse: 0, over: 1, new: 2, same: 2, better: 3 };
  const LV = { campaign: 0, adset: 1, ad: 2 } as const;
  const groups = (list: WatchRow[]) => {
    const m = new Map<string, WatchRow[]>();
    for (const r of list) { if (!m.has(r.clientId)) m.set(r.clientId, []); m.get(r.clientId)!.push(r); }
    const arr = [...m.values()].map((rs) => ({
      id: rs[0].clientId, name: rs[0].clientName,
      rows: [...rs].sort(sort === "status"
        ? (a, b) => RANK[a.flag] - RANK[b.flag] || (a.parentCamp || a.name).localeCompare(b.parentCamp || b.name) || LV[a.level] - LV[b.level] || a.name.localeCompare(b.name)
        : (a, b) => (a.level === "campaign" ? a.name : a.parentCamp).localeCompare(b.level === "campaign" ? b.name : b.parentCamp) || LV[a.level] - LV[b.level] || (a.parentAdset || a.name).localeCompare(b.parentAdset || b.name) || a.name.localeCompare(b.name)),
      worst: Math.min(...rs.map((r) => RANK[r.flag])),
    }));
    return arr.sort((a, b) => a.worst - b.worst || a.name.localeCompare(b.name));
  };
  const count = (rs: WatchRow[], f: (x: WatchRow) => boolean) => rs.filter(f).length;
  const table = (list: WatchRow[]) => (
    <div style={{ overflowX: "auto" }}>
      <table className="tbl">
        {head}
        <tbody>
          {groups(list).map((g) => (
            <FragmentRow key={g.id}>
              <tr>
                <td colSpan={9} style={{ background: "var(--surface2)", padding: "8px 12px" }}>
                  <b>{g.name}</b>
                  <span className="sub" style={{ margin: "0 0 0 10px" }}>
                    {g.rows.length}
                    {count(g.rows, (r) => r.flag === "stop" || r.flag === "worse") > 0 && <span style={{ color: "var(--red)", marginLeft: 8 }}>● {count(g.rows, (r) => r.flag === "stop" || r.flag === "worse")}</span>}
                    {count(g.rows, (r) => r.flag === "over") > 0 && <span style={{ color: "var(--orange)", marginLeft: 8 }}>● {count(g.rows, (r) => r.flag === "over")}</span>}
                    {count(g.rows, (r) => r.flag === "better") > 0 && <span style={{ color: "var(--green)", marginLeft: 8 }}>● {count(g.rows, (r) => r.flag === "better")}</span>}
                  </span>
                </td>
              </tr>
              {g.rows.map((r) => <FragmentRow key={r.id}>{line(r)}{r.status === "closed" && r.closeNote && <tr><td colSpan={9}><span className="sub" dir="auto" style={{ margin: 0 }}>{r.closeNote}</span></td></tr>}</FragmentRow>)}
            </FragmentRow>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <div className="topbar" style={{ marginBottom: 14 }}>
        <div><div className="h1" style={{ fontSize: 20 }}>Watch</div><div className="sub">{open.length} open</div></div>
        <button className="btn pri" onClick={() => setAdding(true)}>+ Add</button>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select value={fc} onChange={(e) => { setFc(e.target.value); writeCid(e.target.value); }}>
          <option value="">All clients</option>
          {clientsWith.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="btabs" style={{ margin: 0 }}>
          <span className={`btab ${sort === "status" ? "on" : ""}`} onClick={() => setSort("status")}>By status</span>
          <span className={`btab ${sort === "campaign" ? "on" : ""}`} onClick={() => setSort("campaign")}>By campaign</span>
        </div>
      </div>

      <div className="panel">
        {open.length === 0 ? <div className="sub" style={{ margin: 0 }}>Nothing is being watched</div> : table(open)}
      </div>

      {closed.length > 0 && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3 style={{ cursor: "pointer" }} onClick={() => setShowClosed(!showClosed)}>Closed ({closed.length}) {showClosed ? "▾" : "▸"}</h3>
          {showClosed && table(closed)}
        </div>
      )}

      {adding && (
        <div className="overlay" onClick={() => setAdding(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add to Watch</h2>
            <select value={cid} onChange={(e) => setCid(e.target.value)} style={{ width: "100%" }}>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="btabs" style={{ margin: "10px 0" }}>
              {LEVELS.map(([k, l]) => <span key={k} className={`btab ${lvl === k ? "on" : ""}`} onClick={() => setLvl(k)}>{l}</span>)}
            </div>
            <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
            <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "100%", marginBottom: 6 }} />
            <div style={{ maxHeight: 260, overflowY: "auto" }}>
              {loading ? <div className="sub">Loading…</div> : shown.length === 0 ? <div className="sub">{msg || "Nothing found"}</div> : shown.map((t, i) => {
                const p = shown[i - 1];
                const newCamp = !!t.camp && (!p || p.camp !== t.camp);
                const newSet = !!t.adset && (!p || p.camp !== t.camp || p.adset !== t.adset);
                return (
                  <div key={t.key}>
                    {newCamp && <div className="sub" style={{ margin: "10px 0 2px", fontWeight: 700, color: "var(--t2)" }}>{t.camp}</div>}
                    {newSet && <div className="sub" style={{ margin: "4px 0 0 10px" }}>↳ {t.adset}</div>}
                    <div className="dsum" style={{ paddingLeft: t.adset ? 24 : t.camp ? 12 : 4, opacity: t.sub === "Active" ? 1 : 0.75 }} onClick={() => !pending && add(t)}>
                      <span><b>{t.name}</b></span><span className="sub" style={{ margin: 0 }}>{t.sub}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {msg && shown.length > 0 && <div className="sub" style={{ marginTop: 8 }}>{msg}</div>}
            <div className="acts" style={{ marginTop: 14 }}><button className="btn" onClick={() => setAdding(false)}>Cancel</button></div>
          </div>
        </div>
      )}

      {closing && (
        <div className="overlay" onClick={() => setClosing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Close — {closing.name}</h2>
            <div className="sub">{closing.before !== "—" ? `${closing.before} → ` : ""}{closing.cost} · {money(closing.spend)} spent</div>
            <input autoFocus placeholder="Result note (optional)" value={closeNote} onChange={(e) => setCloseNote(e.target.value)} style={{ width: "100%" }} />
            <div className="acts" style={{ marginTop: 14 }}>
              <button className="btn" onClick={() => setClosing(null)}>Cancel</button>
              <button className="btn pri" disabled={pending} onClick={() => start(async () => { await closeWatch(closing.id, closeNote); setClosing(null); router.refresh(); })}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FragmentRow({ children }: { children: ReactNode }) { return <>{children}</>; }
