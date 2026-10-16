"use server";
import { createServerSupabase } from "@/lib/supabase/server";
import { askAI } from "@/lib/ai";
import { buildContext } from "@/lib/ai-context";

const SYSTEM = `You are a senior Meta (Facebook/Instagram) ads analyst helping one media buyer manage clients.
You receive a JSON snapshot of ONE client's period. Rules:
- Answer in Arabic (Iraqi-friendly, simple), keep numbers, campaign names and technical terms in English.
- Never sum or compare different result types (messages, reach, visits, engagement); reach cost is per 1,000 reached.
- Use only the numbers in the data. If data is missing or the sample is small, say so; do not invent.
- Be concise and practical: what is happening, why (likely cause from the data: ad set, region, age, gender, platform, placement, recent days trend, pacing vs target), and what to do next. Short bullets, no long intro.`;

export async function analyzeClient(clientId: string, question: string, periodStart?: string): Promise<{ ok: boolean; text: string }> {
  const sb = createServerSupabase();
  const { data } = await sb.auth.getUser();
  if (!data.user) return { ok: false, text: "Unauthorized" };
  const ctx = await buildContext(sb, clientId, periodStart || null);
  if (!ctx) return { ok: false, text: "Client not found" };
  const q = question.trim().slice(0, 1000) ||
    "Analyze this client's current situation: which campaigns are late or at risk, what is wrong, what is working, and the top 3 actions to take now.";
  const r = await askAI(SYSTEM, `DATA:\n${ctx}\n\nREQUEST:\n${q}`);
  return { ok: r.ok, text: r.text };
}
