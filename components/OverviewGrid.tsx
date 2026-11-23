"use client";
import type React from "react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markSeen } from "@/app/(app)/overview/actions";

export type OvChip = { text: string; tone: "bad" | "warn" | "mute"; seen?: { campaignId: string; periodStart: string; spend: number } };
export type OvCard = {
  id: string; name: string; left: string; ring: number; ringText: string; color: string; count: number;
  chips: OvChip[]; late: boolean; account: boolean; noTarget: boolean;
};
type Tab = "all" | "late" | "account" | "none";
const TABS: { k: Tab; l: string }[] = [{ k: "all", l: "All" }, { k: "late", l: "Late" }, { k: "account", l: "Account issues" }, { k: "none", l: "No target" }];

export default function OverviewGrid({ cards }: { cards: OvCard[] }) {
  const [tab, setTab] = useState<Tab>("all");
  const [pending, start] = useTransition();
  const router = useRouter();
  const shown = cards.filter((c) => tab === "all" || (tab === "late" && c.late) || (tab === "account" && c.account) || (tab === "none" && c.noTarget));
  const n = (t: Tab) => cards.filter((c) => t === "all" || (t === "late" && c.late) || (t === "account" && c.account) || (t === "none" && c.noTarget)).length;
  return (
    <>
      <div className="btabs" style={{ marginTop: 0, marginBottom: 12 }}>
        {TABS.map((t) => <span key={t.k} className={`btab ${tab === t.k ? "on" : ""}`} onClick={() => setTab(t.k)}>{t.l} · {n(t.k)}</span>)}
      </div>
      <div className="ovgrid">
        {shown.map((c) => (
          <Link href={`/performance?client=${c.id}`} className="ovc" key={c.id}>
            <div className="hd">
              <span className="who">
                <span className="ring" style={{ "--p": c.ring, "--c": c.color } as React.CSSProperties}><i>{c.ringText}</i></span>
                <span style={{ minWidth: 0 }}><b>{c.name}</b><small>{c.left}</small></span>
              </span>
              <span className="cnt">{c.count} campaign{c.count === 1 ? "" : "s"}</span>
            </div>
            {c.chips.length > 0 && (
              <div className="chips">
                {c.chips.map((x, i) => (
                  <span key={i} className={`chip sm ${x.tone}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {x.text}
                    {x.seen && (
                      <button
                        title="Seen"
                        disabled={pending}
                        style={{ all: "unset", cursor: "pointer", fontWeight: 700, lineHeight: 1, padding: "0 2px" }}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); const s = x.seen!; start(async () => { await markSeen(s.campaignId, s.periodStart, s.spend); router.refresh(); }); }}
                      >✓</button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </Link>
        ))}
      </div>
      {shown.length === 0 && <div className="panel"><div className="fnd ok"><b>Nothing here</b></div></div>}
    </>
  );
}
