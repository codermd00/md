import { graph, normAct } from "./meta";

export type Check = { key: string; label: string; ok: boolean; detail: string };

export type ConnectivityResult = {
  checks: Check[];
  adAccountId: string;
  pageId?: string;
  igUserId?: string;
  igUsername?: string;
  accountStatus?: string;
};

const ACCOUNT_STATUS: Record<number, string> = {
  1: "active", 2: "disabled", 3: "unsettled", 7: "pending_risk_review",
  8: "pending_settlement", 9: "grace_period", 100: "pending_closure",
  101: "closed", 201: "any_active", 202: "any_closed",
};

async function step(
  checks: Check[], key: string, label: string, fn: () => Promise<string>
): Promise<boolean> {
  try {
    checks.push({ key, label, ok: true, detail: await fn() });
    return true;
  } catch (e: any) {
    checks.push({ key, label, ok: false, detail: e?.message || "خطأ غير معروف" });
    return false;
  }
}



/** يختبر السلسلة كاملة لعميل واحد: توكن ← حساب إعلاني ← صفحة ← انستغرام ← إحصائيات ← منشورات */
export async function testClientConnectivity(adAccountRaw: string): Promise<ConnectivityResult> {
  const adAccountId = normAct(adAccountRaw);
  const checks: Check[] = [];
  const out: ConnectivityResult = { checks, adAccountId };

  const tokenOk = await step(checks, "token", "التوكن", async () => {
    const me = await graph<{ id: string; name?: string }>("me", { fields: "id,name" });
    return `صالح (${me.name || me.id})`;
  });
  if (!tokenOk) return out;

  const accOk = await step(checks, "account", "الحساب الإعلاني", async () => {
    const a = await graph<any>(`act_${adAccountId}`, { fields: "name,account_status,currency,timezone_name" });
    out.accountStatus = ACCOUNT_STATUS[a.account_status] || String(a.account_status);
    return `${a.name} · ${out.accountStatus} · ${a.currency} · ${a.timezone_name}`;
  });
  if (!accOk) return out;

  await step(checks, "insights", "إحصائيات الإعلانات", async () => {
    const r = await graph<{ data: any[] }>(`act_${adAccountId}/insights`, {
      fields: "spend,reach", date_preset: "last_7d",
    });
    const row = r.data?.[0];
    return row ? `آخر 7 أيام: صرف ${row.spend} · وصول ${row.reach}` : "لا صرف خلال آخر 7 أيام";
  });

  await step(checks, "page", "صفحة فيسبوك", async () => {
    const r = await graph<{ data: { id: string; name: string }[] }>(
      `act_${adAccountId}/promote_pages`, { fields: "id,name", limit: 5 }
    );
    if (!r.data?.length) throw new Error("لا توجد صفحة مرتبطة بالحساب الإعلاني");
    out.pageId = r.data[0].id;
    return `${r.data[0].name} (${r.data[0].id})`;
  });

  await step(checks, "instagram", "حساب انستغرام", async () => {
    const r = await graph<{ data: { id: string; username?: string }[] }>(
      `act_${adAccountId}/instagram_accounts`, { fields: "id,username", limit: 5 }
    );
    let ig = r.data?.[0];
    if (!ig && out.pageId) {
      const p = await graph<any>(out.pageId, { fields: "instagram_business_account{id,username}" });
      ig = p.instagram_business_account;
    }
    if (!ig) throw new Error("لا يوجد حساب انستغرام مرتبط");
    out.igUserId = ig.id;
    out.igUsername = ig.username;
    return `@${ig.username || "?"} (${ig.id})`;
  });

  if (out.igUserId) {
    const igId = out.igUserId;
    await step(checks, "media", "قراءة المنشورات", async () => {
      const r = await graph<{ data: any[] }>(`${igId}/media`, {
        fields: "shortcode,boost_eligibility_info", limit: 3,
      });
      if (!r.data?.length) return "لا منشورات";
      return r.data
        .map((m) => `${m.shortcode} ${m.boost_eligibility_info?.eligible_to_boost ? "✓" : "✗"}`)
        .join(" · ");
    });
  }
  return out;
}
