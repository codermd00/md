"use client";
import { useState, useTransition } from "react";
import { analyzeClient } from "@/app/(app)/ai/actions";
import type { AiReport } from "@/lib/ai-report";

const DOT = { bad: "var(--red)", warn: "var(--orange)", good: "var(--green)" } as const;

export default function AiPanel({ clientId, periodStart }: { clientId: string; periodStart?: string }) {
  const [q, setQ] = useState("");
  const [out, setOut] = useState<{ ok: boolean; text: string; report?: AiReport } | null>(null);
  const [pending, start] = useTransition();
  const go = (question: string) => start(async () => { setOut(null); setOut(await analyzeClient(clientId, question, periodStart)); });

  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h3>AI Analysis</h3>
        <button className="btn pri" onClick={() => go("")} disabled={pending}>{pending ? "Analyzing…" : "Analyze"}</button>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) go(q); }} style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask AI…" dir="auto" style={{ flex: 1 }} />
        <button className="btn" type="submit" disabled={pending || !q.trim()}>Ask</button>
      </form>
      {out && !out.ok && <div className="msg err" dir="auto" style={{ marginTop: 12 }}>{out.text}</div>}
      {out && out.ok && out.report && (
        <div dir="auto" style={{ marginTop: 14, lineHeight: 1.7 }}>
          {out.report.summary && <div style={{ fontSize: 14, marginBottom: 14 }}>{out.report.summary}</div>}
          {out.report.campaigns.map((c, i) => (
            <div key={i} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
              <div><span className="wdotl" style={{ background: DOT[c.status] }} /><b dir="ltr">{c.name}</b></div>
              {c.note && <div style={{ marginTop: 2 }}>{c.note}</div>}
              {c.action && <div style={{ marginTop: 2, color: "var(--blue2)" }}>{c.action}</div>}
            </div>
          ))}
          {out.report.actions.length > 0 && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
              <div className="sub" style={{ marginBottom: 6, fontWeight: 700 }}>Do now</div>
              {out.report.actions.map((a, i) => <div key={i} style={{ display: "flex", gap: 10, marginBottom: 6 }}><b style={{ color: "var(--blue2)" }}>{i + 1}</b><span>{a}</span></div>)}
            </div>
          )}
        </div>
      )}
      {out && out.ok && !out.report && out.text.split(/\n+/).map((l, i) => <div key={i} dir="auto" style={{ marginTop: i ? 8 : 12, lineHeight: 1.7 }}>{l}</div>)}
    </div>
  );
}
