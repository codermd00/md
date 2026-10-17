"use client";
import { useState } from "react";

export type HealthRow = { name: string; ago: string; stale: boolean; error: string };
const EMOJI = { ok: "🟢", warn: "🟡", bad: "🔴" } as const;

export default function DataHealth({ status, rows }: { status: "ok" | "warn" | "bad"; rows: HealthRow[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)} title="Data Health" style={{ fontSize: 10, lineHeight: 1, padding: "6px 9px", minHeight: 0 }}>{EMOJI[status]}</button>
      {open && (
        <div className="overlay" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Data Health</h2>
            {rows.map((r) => (
              <div className="dsum" key={r.name} style={{ cursor: "default", alignItems: "flex-start" }}>
                <span>
                  {r.name}
                  {r.error && <div className="sub" style={{ margin: 0, color: "var(--red)" }} dir="auto">{r.error}</div>}
                </span>
                <span className={`chip sm ${r.error ? "bad" : r.stale ? "warn" : "ok"}`}>{r.ago}</span>
              </div>
            ))}
            <div className="acts" style={{ marginTop: 14 }}><button className="btn" onClick={() => setOpen(false)}>Close</button></div>
          </div>
        </div>
      )}
    </>
  );
}
