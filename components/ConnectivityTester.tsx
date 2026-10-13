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
      catch (e: any) { setErr(e?.message || "فشل الاختبار"); }
    });
  }

  const failed = res?.checks.filter((c) => !c.ok).length ?? 0;

  return (
    <div className="card">
      <h3>Connection Test</h3>
      <div className="row" style={{ marginTop: 14 }}>
        <label className="f">Ad Account ID<input value={acc} onChange={(e) => setAcc(e.target.value)} placeholder="1234567890 أو act_1234567890" /></label>
        <div style={{ flex: "0 0 auto", minWidth: 0 }}>
          <button className="btn pri" onClick={run} disabled={pending || !acc.trim()}>{pending ? "جارٍ الفحص..." : "اختبر"}</button>
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
            {failed ? `${failed} فحص فاشل — أرسل لي النص الأحمر لأصلحه.` : "كل الفحوصات ناجحة ✓"}
          </div>
          {(res.pageId || res.igUserId) && (
            <div style={{ marginTop: 10 }}>
              {res.pageId && <div className="kv"><span>Page ID</span><span>{res.pageId}</span></div>}
              {res.igUserId && <div className="kv"><span>Instagram ID</span><span>{res.igUserId} · @{res.igUsername}</span></div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
