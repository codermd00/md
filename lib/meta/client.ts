/**
 * طبقة واحدة تغلّف كل التعامل مع Meta Graph API.
 * تُستخدم فقط من كود يعمل على السيرفر (API Routes / scripts) — الـ Access Token
 * يُقرأ من متغيرات البيئة ولا يصل إطلاقاً إلى المتصفح.
 */

const META_API_VERSION = process.env.META_API_VERSION || "v24.0";
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN!;
const BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

const MAX_RETRIES = 5;

/** أكواد أخطاء Meta المرتبطة بتجاوز حدود الاستخدام (Rate Limit) */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80004]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * نداء GET واحد إلى Graph API مع إعادة محاولة تصاعدية (exponential backoff)
 * عند الاصطدام بحدود الاستخدام.
 */
async function metaGet<T = any>(
  path: string,
  params: Record<string, string | number> = {}
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("access_token", META_ACCESS_TOKEN);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  let attempt = 0;
  while (true) {
    const res = await fetch(url.toString(), { method: "GET" });
    const json = await res.json();

    if (res.ok) return json as T;

    const errorCode = json?.error?.code;
    const isRateLimited = RATE_LIMIT_CODES.has(errorCode);

    if (isRateLimited && attempt < MAX_RETRIES) {
      const backoffMs = Math.min(2 ** attempt * 1000, 30_000);
      attempt++;
      await sleep(backoffMs);
      continue;
    }

    throw new Error(
      `Meta API error [${errorCode ?? res.status}]: ${
        json?.error?.message ?? "unknown error"
      } (path: ${path})`
    );
  }
}

/**
 * يجلب كل الصفحات (pagination عبر after cursor) ويعيد مصفوفة واحدة بكل النتائج.
 */
async function metaGetAllPages<T = any>(
  path: string,
  params: Record<string, string | number> = {}
): Promise<T[]> {
  const results: T[] = [];
  let after: string | undefined;

  do {
    const page = await metaGet<{ data: T[]; paging?: { cursors?: { after?: string }; next?: string } }>(
      path,
      after ? { ...params, after } : params
    );
    results.push(...(page.data ?? []));
    after = page.paging?.cursors?.after && page.paging?.next ? page.paging.cursors.after : undefined;
  } while (after);

  return results;
}

// ---------------------------------------------------------------------------
// دوال الجلب لكل مستوى — تُرجع الحقول التي نحتاجها فقط
// ---------------------------------------------------------------------------

export async function fetchAdAccount(metaAccountId: string) {
  return metaGet<{
    id: string;
    name: string;
    currency: string;
    timezone_name: string;
    account_status: number;
  }>(`/${metaAccountId}`, {
    fields: "id,name,currency,timezone_name,account_status",
  });
}

export async function fetchCampaigns(metaAccountId: string) {
  return metaGetAllPages(`/${metaAccountId}/campaigns`, {
    fields:
      "id,name,objective,status,effective_status,buying_type,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time",
    limit: 100,
  });
}

export async function fetchAdSets(metaCampaignId: string) {
  return metaGetAllPages(`/${metaCampaignId}/adsets`, {
    fields:
      "id,name,status,effective_status,optimization_goal,billing_event,bid_strategy,daily_budget,lifetime_budget,start_time,end_time,targeting",
    limit: 100,
  });
}

export async function fetchAds(metaAdSetId: string) {
  return metaGetAllPages(`/${metaAdSetId}/ads`, {
    fields:
      "id,name,status,effective_status,creative{id,object_story_spec,thumbnail_url,image_url,video_id,body,title,call_to_action_type},created_time,updated_time",
    limit: 100,
  });
}

/**
 * يجلب الـ Insights اليومية لأي مستوى (account/campaign/adset/ad) خلال مدى تاريخي.
 * level: "account" | "campaign" | "adset" | "ad"
 */
export async function fetchInsights(
  objectId: string,
  since: string,
  until: string,
  level: "account" | "campaign" | "adset" | "ad"
) {
  return metaGetAllPages(`/${objectId}/insights`, {
    level,
    time_increment: 1, // يوم بيوم
    time_range: JSON.stringify({ since, until }),
    fields:
      "spend,impressions,reach,frequency,clicks,inline_link_clicks,ctr,cpc,cpm,actions,cost_per_action_type,date_start",
    limit: 500,
  });
}
