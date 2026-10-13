"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function PasswordForm() {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setMsg({ ok: false, text: "At least 8 characters" });
    const { error } = await createClient().auth.updateUser({ password: pw });
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Password changed" });
    if (!error) setPw("");
  }
  return (
    <form className="card" onSubmit={save}>
      <h3>Password</h3>
      <div className="row" style={{ marginTop: 14 }}>
        <label className="f">New password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <div style={{ flex: "0 0 auto", minWidth: 0 }}><button className="btn">Change</button></div>
      </div>
      {msg && <div className={`msg ${msg.ok ? "" : "err"}`}>{msg.text}</div>}
    </form>
  );
}
