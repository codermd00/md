"use client";
import Link from "next/link";
import { useState } from "react";

export type YCamp = { name: string; type: string; spend: number; results: number; cost: string; delta: number | null; stopped: boolean };
export type YClient = { id: string; name: string; spend: number; flag: "stop" | "worse" | "better" | "same"; campaigns: YCamp[] };

const money = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const ICON = { stop: "⚠", worse: "▲", better: "▼", same: "▬" } as const;
const COLOR = { stop: "var(--red)", worse: "var(--red)", better: "var(--green)", same: "var(--t3)" } as const;
const UNIT: Record<string, string> = { Messages: "messages", Reach: "reached", Visit: "visits", Engagement: "engagements", Other: "results" };

export default function YesterdayStrip({ label, clients }: { label: string; clients: YClient[] }) {
  const [open, setOpen] = useState<YClient | null>(null);
  if (clients.length === 0) return null;
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <h3>Yesterday <span className="sub" style={{ marginLeft: 6 }}>{label}</span></h3>
      <div className="ystrip">
        {clients.map((c) => (
          <button key={c.id} className="ycard" onClick={() => setOpen(c)}>
            <div className="yt"><b>{c.name}</b><span style={{ color: COLOR[c.flag] }}>{ICON[c.flag]}</span></div>
            <div className="yv">{c.flag === "stop" && c.spend === 0 ? "No spend" : money(c.spend)}</div>
            <div className="ys">{c.campaigns.length} campaign{c.campaigns.length === 1 ? "" : "s"}</div>
          </button>
        ))}
      </div>

      {open && (
        <div className="overlay" onClick={() => setOpen(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{open.name} <span className="sub" style={{ marginLeft: 6 }}>{label}</span></h2>
            {open.campaigns.length === 0 ? <div className="sub">No spend</div> : open.campaigns.map((k, i) => (
              <div className="dsum" key={i} style={{ cursor: "default", alignItems: "flex-start" }}>
                <span>
                  <b>{k.name}</b>
                  <div className="sub" style={{ margin: 0 }}>{k.type}</div>
                </span>
                <span style={{ textAlign: "right" }}>
                  {k.stopped ? <b style={{ color: "var(--red)" }}>⚠ No spend</b> : (
                    <>
                      <b>{money(k.spend)}</b> · {Math.round(k.results).toLocaleString("en-US")} {UNIT[k.type] || "results"}
                      <div className="sub" style={{ margin: 0 }}>
                        {k.cost}
                        {k.delta !== null && Math.abs(k.delta) >= 1 && (
                          <b style={{ marginLeft: 6, color: k.delta > 0 ? "var(--red)" : "var(--green)" }}>{k.delta > 0 ? "▲" : "▼"} {Math.abs(Math.round(k.delta))}%</b>
                        )}
                      </div>
                    </>
                  )}
                </span>
              </div>
            ))}
            <div className="acts" style={{ marginTop: 14 }}>
              <button className="btn" onClick={() => setOpen(null)}>Close</button>
              <Link className="btn pri" href={`/performance?client=${open.id}`}>Open Performance</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
