// عميل Meta Graph — سيرفر فقط. التوكن من متغير بيئة ولا يصل للمتصفح.
const VERSION = process.env.META_API_VERSION || "v24.0";
const BASE = `https://graph.facebook.com/${VERSION}`;

export class MetaError extends Error {
  code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.code = code;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);
const isTransient = (status: number, e: any) =>
  status >= 500 || TRANSIENT_CODES.has(Number(e?.code)) || /temporarily unavailable|try again|reduce the amount/i.test(String(e?.message || ""));

/** fetch من Meta مع إعادة محاولة (3 مرات) عند الأعطال المؤقتة */
async function metaFetch(url: string): Promise<any> {
  let last: MetaError | null = null;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { cache: "no-store" });
    const json: any = await res.json().catch(() => ({}));
    if (res.ok && !json.error) return json;
    const e = json.error || {};
    last = new MetaError(e.message || `HTTP ${res.status}`, e.code);
    if (!isTransient(res.status, e) || i === 3) break;
    await sleep(1200 * (i + 1));
  }
  throw last!;
}

export async function graph<T = any>(
  path: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new MetaError("META_ACCESS_TOKEN not set");
  const url = new URL(`${BASE}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  url.searchParams.set("access_token", token);
  const json = await metaFetch(url.toString());
  return json as T;
}

export const normAct = (id: string) => id.replace(/^act_/, "").trim();

/** يجلب كل الصفحات (paging.next) لقائمة من Meta. */
export async function graphAll<T = any>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  maxPages = 20
): Promise<T[]> {
  let page: any = await graph<any>(path, { limit: 200, ...params });
  const out: T[] = [...(page.data || [])];
  let n = 1;
  while (page.paging?.next && n < maxPages) {
    page = await metaFetch(page.paging.next);
    out.push(...(page.data || []));
    n++;
  }
  return out;
}

/** يجلب كائنات بمعرّفاتها دفعات من 50 بالتوازي: GET /?ids=a,b,c — يعيد خريطة id → كائن */
export async function graphIds<T = any>(ids: string[], fields: string): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  const uniq = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let i = 0; i < uniq.length; i += 50) chunks.push(uniq.slice(i, i + 50));
  const results = await Promise.all(chunks.map((c) => graph<Record<string, T>>("", { ids: c.join(","), fields })));
  for (const r of results) for (const [k, v] of Object.entries(r)) out.set(k, v);
  return out;
}

/** POST إلى Meta (بدون إعادة محاولة حتى لا يتكرر إنشاء كائن). */
export async function graphPost<T = any>(path: string, body: Record<string, any> = {}): Promise<T> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new MetaError("META_ACCESS_TOKEN not set");
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null) continue;
    form.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  form.set("access_token", token);
  const res = await fetch(`${BASE}/${path.replace(/^\//, "")}`, { method: "POST", body: form, cache: "no-store" });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error || {};
    throw new MetaError([e.error_user_msg, e.message].filter(Boolean).join(" — ") || `HTTP ${res.status}`, e.code);
  }
  return json as T;
}
