// OpenRouter with automatic fallback: tries each model in order until one answers.
const DEFAULT_MODELS = [
  "meta/muse-wonder",
  "anthropic/claude-sonnet-4.5",
  "google/gemini-2.5-flash",
  "openai/gpt-4o-mini",
  "deepseek/deepseek-chat",
  "meta-llama/llama-3.3-70b-instruct:free",
  "openrouter/auto",
];

export function aiModels(): string[] {
  const env = (process.env.AI_MODELS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return env.length ? env : DEFAULT_MODELS;
}

export async function askAI(system: string, user: string): Promise<{ ok: boolean; text: string; model?: string }> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, text: "OPENROUTER_API_KEY is not set" };
  let last = "";
  for (const model of aiModels()) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-title": "Ads Dashboard" },
        body: JSON.stringify({ model, max_tokens: 1200, temperature: 0.3, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
        signal: AbortSignal.timeout(60000),
      });
      const j: any = await res.json().catch(() => ({}));
      const text = j?.choices?.[0]?.message?.content;
      if (res.ok && typeof text === "string" && text.trim()) return { ok: true, text: text.trim(), model };
      last = `${model}: ${j?.error?.message || res.status}`;
    } catch (e: any) {
      last = `${model}: ${e?.message || "failed"}`;
    }
  }
  return { ok: false, text: "All models failed — " + last.slice(0, 200) };
}
