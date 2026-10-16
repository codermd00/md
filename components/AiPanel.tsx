"use client";
import { useState, useTransition } from "react";
import { analyzeClient } from "@/app/(app)/ai/actions";

export default function AiPanel({ clientId, periodStart }: { clientId: string; periodStart?: string }) {
  const [q, setQ] = useState("");
  const [out, setOut] = useState<{ ok: boolean; text: string } | null>(null);
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
      {out && <div className={out.ok ? "" : "msg err"} dir="auto" style={{ marginTop: 12, whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{out.text}</div>}
    </div>
  );
}
