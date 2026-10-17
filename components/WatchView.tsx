"use client";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { addWatch, closeWatch, deleteWatch, listTargets, type Target } from "@/app/(app)/watch/actions";
import type { WatchRow } from "@/lib/watch";
import { FLAG_COLOR, FLAG_TEXT, LEVEL } from "./WatchLine";

const money = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const LEVELS = [["campaign", "Campaign"], ["adset", "Ad set"], ["ad", "Ad"]] as const;

export default function WatchView({ clients, rows }: { clients: { id: string; name: string }[]; rows: WatchRow[] }) {
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

  const open = rows.filter((r) => r.status === "open");
  const closed = rows.filter((r) => r.status === "closed");
  const shown = targets.filter((t) => !q || (t.name + " " + t.camp + " " + t.adset).toLowerCase().includes(q.toLowerCase()));

  const add = (t: Target) => start(async () => {
    const r = await addWatch({ level: lvl, clientId: cid, metaId: t.key, name: t.name, note });
    setMsg(r.message);
    if (r.ok) { setAdding(false); setNote(""); setQ(""); router.refresh(); }
  });

  const line = (r: WatchRow) => (
    <tr key={r.id}>
      <td><span className="wdotl" style={{ background: FLAG_COLOR[r.flag] }} /><b>{r.name}</b>{r.note && <div className="sub" style={{ margin: 0 }} dir="auto">{r.note}</div>}</td>
      <td>{r.clientName}</td>
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
    <thead><tr><th>Item</th><th>Client</th><th>Type</th><th>Days</th><th>Before</th><th>Now</th><th>Spend</th><th>Results</th><th>Status</th><th /></tr></thead>
  );

  return (
    <>
      <div className="topbar" style={{ marginBottom: 14 }}>
        <div><div className="h1" style={{ fontSize: 20 }}>Watch</div><div className="sub">{open.length} open</div></div>
        <button className="btn pri" onClick={() => setAdding(true)}>+ Add</button>
      </div>

      <div className="panel">
        {open.length === 0 ? <div className="sub" style={{ margin: 0 }}>Nothing is being watched</div> : (
          <div style={{ overflowX: "auto" }}><table className="tbl">{head}<tbody>{open.map(line)}</tbody></table></div>
        )}
      </div>

      {closed.length > 0 && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3 style={{ cursor: "pointer" }} onClick={() => setShowClosed(!showClosed)}>Closed ({closed.length}) {showClosed ? "▾" : "▸"}</h3>
          {showClosed && <div style={{ overflowX: "auto" }}><table className="tbl">{head}<tbody>{closed.map((r) => (
            <FragmentRow key={r.id}>{line(r)}{r.closeNote && <tr><td colSpan={10}><span className="sub" dir="auto" style={{ margin: 0 }}>{r.closeNote}</span></td></tr>}</FragmentRow>
          ))}</tbody></table></div>}
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
