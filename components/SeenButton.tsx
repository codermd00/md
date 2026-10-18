"use client";
import { useTransition } from "react";
import { markSeen } from "@/app/(app)/overview/actions";

export default function SeenButton({ campaignId, periodStart, spend }: { campaignId: string; periodStart: string; spend: number }) {
  const [pending, start] = useTransition();
  return (
    <button className="btn" style={{ padding: "3px 10px", fontSize: 11 }} disabled={pending} onClick={() => start(() => markSeen(campaignId, periodStart, spend))}>
      {pending ? "…" : "Seen"}
    </button>
  );
}
