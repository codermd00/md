"use client";
import { useState, useTransition } from "react";
import { runConnectivity } from "@/app/(app)/settings/actions";
import type { ConnectivityResult } from "@/lib/connectivity";

export default function ConnectivityTester() {
  const [acc, setAcc] = useState("");
  const [res, setRes] = useState<ConnectivityResult | null>(null);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  function run() {
    setErr(""); setRes(null);
    start(async () => {
      try { setRes(await runConnectivity(acc)); }
      catch (e: any) { setErr(e?.message || "Test failed"); }
    });
  }

  const failed = res?.checks.filter((c) => !c.ok).length ?? 0;

  return (
    <div className="card">
      <h3>Connection Test</h3>
      <div className="row" style={{ marginTop: 14 }}>
        <label className="f">Ad Account ID<input value={acc} onChange={(e) => setAcc(e.target.value)} placeholder="1234567890 or act_1234567890" /></label>
        <div style={{ flex: "0 0 auto", minWidth: 0 }}>
          <button className="btn pri" onClick={run} disabled={pending || !acc.trim()}>{pending ? "Testing..." : "Test"}</button>
        </div>
      </div>
      {err && <div className="msg err">{err}</div>}
      {res && (
        <>
          <div className="checks">
            {res.checks.map((c) => (
              <div className="chk" key={c.key}>
                <i className={`dot ${c.ok ? "ok" : "bad"}`} />
                <b>{c.label}</b><span>{c.detail}</span>
              </div>
            ))}
          </div>
          <div className={`msg ${failed ? "err" : ""}`}>
            {failed ? `${failed} check(s) failed` : "All checks passed ✓"}
          </div>
          {(res.pages?.length || res.igs?.length) ? (
            <div style={{ marginTop: 10 }}>
              {res.pages?.map((p) => <div className="kv" key={p.id}><span>Page · {p.name}</span><span>{p.id}</span></div>)}
              {res.igs?.map((g) => <div className="kv" key={g.id}><span>Instagram</span><span>{g.id} · @{g.username}</span></div>)}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
