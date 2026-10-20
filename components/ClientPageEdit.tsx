"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveGoal } from "@/app/(app)/performance/actions";
import type { ClientInput } from "@/app/(app)/clients/actions";
import ClientForm from "./ClientForm";

export function EditClientButton({ initial }: { initial: ClientInput }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>Edit</button>
      {open && <ClientForm initial={initial} onClose={() => setOpen(false)} onDone={() => router.refresh()} />}
    </>
  );
}

export function EditGoalButton({ campaignId, name, typeLabel, periodStart, budget, target }: {
  campaignId: string; name: string; typeLabel: string; periodStart: string; budget: number | null; target: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [b, setB] = useState(budget != null ? String(budget) : "");
  const [t, setT] = useState(target != null ? String(target) : "");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  function submit() {
    start(async () => {
      const r = await saveGoal({ campaignId, periodStart, budget: b, target: t });
      if (r.ok) { setOpen(false); router.refresh(); } else setMsg(r.message);
    });
  }
  return (
    <>
      <button className="btn" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => { setB(budget != null ? String(budget) : ""); setT(target != null ? String(target) : ""); setMsg(""); setOpen(true); }}>Edit</button>
      {open && (
        <div className="overlay" onClick={() => !pending && setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{name}</h2>
            <div className="sub" style={{ marginBottom: 14 }}>{typeLabel}</div>
            <div className="grid g2">
              <label className="f">Campaign budget ($)<input type="number" value={b} onChange={(e) => setB(e.target.value)} /></label>
              <label className="f">{`Target (${typeLabel})`}<input type="number" value={t} onChange={(e) => setT(e.target.value)} /></label>
            </div>
            {msg && <div className="msg err">{msg}</div>}
            <div className="acts">
              <button className="btn" onClick={() => setOpen(false)} disabled={pending}>Cancel</button>
              <button className="btn pri" onClick={submit} disabled={pending}>{pending ? "..." : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
