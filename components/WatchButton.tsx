"use client";
import { useState, useTransition } from "react";
import { addWatch } from "@/app/(app)/watch/actions";

export default function WatchButton({ level, dbId, postId, btn }: { level: "campaign" | "adset" | "ad"; dbId?: string; postId?: string; btn?: boolean }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const add = () => start(async () => {
    const r = await addWatch({ level, dbId, postId, note });
    setMsg(r.message);
    if (r.ok) setTimeout(() => { setOpen(false); setMsg(""); setNote(""); }, 700);
  });
  return (
    <>
      {btn
        ? <button className="btn" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>Watch</button>
        : <a style={{ color: "var(--blue2)", fontWeight: 600, cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); setOpen(true); }}>Watch</a>}
      {open && (
        <div className="overlay" onClick={(e) => { e.stopPropagation(); setOpen(false); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Watch</h2>
            <input autoFocus placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: "100%" }} />
            {msg && <div className="sub" style={{ marginTop: 8 }}>{msg}</div>}
            <div className="acts" style={{ marginTop: 14 }}>
              <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn pri" disabled={pending} onClick={add}>{pending ? "Adding…" : "Add"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
