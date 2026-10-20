"use client";
import { useState, useTransition } from "react";
import { saveClient, type ClientInput } from "@/app/(app)/clients/actions";

export const EMPTY_CLIENT: ClientInput = { name: "", ig_username: "", ad_account_id: "", period_start: "", period_end: "", budget: "", business_type: "", city: "", page_id: "", ig_user_id: "", run_posts: false, alert_messages: "", alert_engagement: "", alert_reach: "", alert_visit: "", alert_leads: "", alert_thruplay: "" };

/** The add / edit client window, shared by the Clients list and the client page */
export default function ClientForm({ initial, onClose, onDone }: { initial: ClientInput; onClose: () => void; onDone: (r: { ok: boolean; message: string }) => void }) {
  const [form, setForm] = useState<ClientInput>(initial);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const set = (k: keyof ClientInput, v: string) => setForm((f) => ({ ...f, [k]: v }));
  function save() {
    start(async () => {
      const r = await saveClient(form);
      if (r.ok) { onDone(r); onClose(); } else setErr(r.message);
    });
  }
  return (
      <div className="overlay" onClick={() => !pending && onClose()}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{form.id ? "Edit client" : "New client"}</h2>
            <div className="grid g2">
              <label className="f">Name<input value={form.name} onChange={(e) => set("name", e.target.value)} /></label>
              <label className="f">Instagram username<input value={form.ig_username} onChange={(e) => set("ig_username", e.target.value)} placeholder="without @" /></label>
              <label className="f" style={{ gridColumn: "1 / -1" }}>Ad account<input value={form.ad_account_id} onChange={(e) => set("ad_account_id", e.target.value)} placeholder="act_1234567890" /></label>
              <label className="f">Period start<input type="date" value={form.period_start} onChange={(e) => set("period_start", e.target.value)} /></label>
              <label className="f">Period end<input type="date" value={form.period_end} onChange={(e) => set("period_end", e.target.value)} /></label>
              <label className="f">Budget ($)<input type="number" value={form.budget} onChange={(e) => set("budget", e.target.value)} /></label>
              <label className="f">Page ID<input dir="ltr" value={form.page_id} onChange={(e) => set("page_id", e.target.value)} placeholder="123456789012345" /></label>
              <label className="f">Instagram ID<input dir="ltr" value={form.ig_user_id} onChange={(e) => set("ig_user_id", e.target.value)} placeholder="Instagram business ID" /></label>
              <label className="f" style={{ flexDirection: "row", alignItems: "center", gap: 8, gridColumn: "1 / -1" }}>
                <input type="checkbox" checked={form.run_posts} onChange={(e) => setForm({ ...form, run_posts: e.target.checked })} style={{ width: "auto" }} />
                Fetch Instagram posts (Content Manager)
              </label>
              <div style={{ gridColumn: "1 / -1", fontSize: 12, fontWeight: 700, color: "var(--t2)" }}>Daily cost alert — max cost per result today ($, as in Ads Manager, empty = off)</div>
              <label className="f">Messages<input type="number" step="any" value={form.alert_messages} onChange={(e) => set("alert_messages", e.target.value)} /></label>
              <label className="f">Engagement<input type="number" step="any" value={form.alert_engagement} onChange={(e) => set("alert_engagement", e.target.value)} /></label>
              <label className="f">Reach (per 1,000)<input type="number" step="any" value={form.alert_reach} onChange={(e) => set("alert_reach", e.target.value)} /></label>
              <label className="f">Visit<input type="number" step="any" value={form.alert_visit} onChange={(e) => set("alert_visit", e.target.value)} /></label>
              <label className="f">Leads<input type="number" step="any" value={form.alert_leads} onChange={(e) => set("alert_leads", e.target.value)} /></label>
              <label className="f">ThruPlay<input type="number" step="any" value={form.alert_thruplay} onChange={(e) => set("alert_thruplay", e.target.value)} /></label>
              <label className="f">Type<input value={form.business_type} onChange={(e) => set("business_type", e.target.value)} /></label>
              <label className="f">City<input value={form.city} onChange={(e) => set("city", e.target.value)} /></label>
            </div>
            {err && <div className="msg err">{err}</div>}
            <div className="acts">
              <button className="btn" onClick={onClose} disabled={pending}>Cancel</button>
              <button className="btn pri" onClick={save} disabled={pending}>{pending ? "Saving..." : "Save"}</button>
            </div>
          </div>
        </div>
  );
}
