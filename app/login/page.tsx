"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    if (error) { setErr("Wrong email or password"); setBusy(false); return; }
    router.replace("/overview");
    router.refresh();
  }

  return (
    <div className="login">
      <div className="lcard">
        <h1>Ads Dashboard</h1>
        <p>Sign in to continue</p>
        <form onSubmit={submit}>
          <label className="f">Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label className="f">Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          <button className="btn pri" disabled={busy} style={{ justifyContent: "center" }}>{busy ? "..." : "Sign in"}</button>
          {err && <div className="msg err">{err}</div>}
        </form>
      </div>
    </div>
  );
}
