import { graph, normAct } from "./meta";

export type Check = { key: string; label: string; ok: boolean; detail: string };

export type ConnectivityResult = {
  checks: Check[];
  adAccountId: string;
  pageId?: string;
  igUserId?: string;
  igUsername?: string;
  pages?: { id: string; name: string }[];
  igs?: { id: string; username?: string; page?: string }[];
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
    checks.push({ key, label, ok: false, detail: e?.message || "Unknown error" });
    return false;
  }
}



/** يختبر السلسلة كاملة لعميل واحد: توكن ← حساب إعلاني ← صفحة ← انستغرام ← إحصائيات ← منشورات */
export async function testClientConnectivity(adAccountRaw: string): Promise<ConnectivityResult> {
  const adAccountId = normAct(adAccountRaw);
  const checks: Check[] = [];
  const out: ConnectivityResult = { checks, adAccountId };

  const tokenOk = await step(checks, "token", "Token", async () => {
    const me = await graph<{ id: string; name?: string }>("me", { fields: "id,name" });
    return `Valid (${me.name || me.id})`;
  });
  if (!tokenOk) return out;

  const accOk = await step(checks, "account", "Ad account", async () => {
    const a = await graph<any>(`act_${adAccountId}`, { fields: "name,account_status,currency,timezone_name" });
    out.accountStatus = ACCOUNT_STATUS[a.account_status] || String(a.account_status);
    return `${a.name} · ${out.accountStatus} · ${a.currency} · ${a.timezone_name}`;
  });
  if (!accOk) return out;

  await step(checks, "insights", "Insights", async () => {
    const r = await graph<{ data: any[] }>(`act_${adAccountId}/insights`, {
      fields: "spend,reach", date_preset: "last_7d",
    });
    const row = r.data?.[0];
    return row ? `Last 7 days: spend ${row.spend} · reach ${row.reach}` : "No spend in the last 7 days";
  });

  const pages: { id: string; name: string }[] = [];
  await step(checks, "page", "Facebook pages", async () => {
    const r = await graph<{ data: { id: string; name: string }[] }>(
      `act_${adAccountId}/promote_pages`, { fields: "id,name", limit: 25 }
    );
    if (!r.data?.length) throw new Error("No page linked to the ad account");
    pages.push(...r.data);
    return r.data.map((p) => `${p.name} (${p.id})`).join(" · ");
  });
  out.pages = pages;
  out.pageId = pages[0]?.id;

  const igs: { id: string; username?: string; page?: string }[] = [];
  await step(checks, "instagram", "Instagram accounts", async () => {
    const r = await graph<{ data: { id: string; username?: string }[] }>(
      `act_${adAccountId}/instagram_accounts`, { fields: "id,username", limit: 25 }
    );
    for (const ig of r.data || []) igs.push({ id: ig.id, username: ig.username });
    for (const pg of pages) {
      try {
        const p = await graph<any>(pg.id, { fields: "instagram_business_account{id,username}" });
        const ig = p.instagram_business_account;
        if (ig && !igs.some((x) => x.id === ig.id)) igs.push({ id: ig.id, username: ig.username, page: pg.name });
      } catch { /* page without access */ }
    }
    if (!igs.length) throw new Error("No Instagram account linked");
    return igs.map((ig) => `@${ig.username || "?"} (${ig.id})`).join(" · ");
  });
  out.igs = igs;
  out.igUserId = igs[0]?.id;
  out.igUsername = igs[0]?.username;

  for (const ig of igs) {
    await step(checks, "media-" + ig.id, `Reading posts · @${ig.username || ig.id}`, async () => {
      const r = await graph<{ data: any[] }>(`${ig.id}/media`, {
        fields: "shortcode,boost_eligibility_info", limit: 3,
      });
      if (!r.data?.length) return "No posts";
      return r.data
        .map((m) => `${m.shortcode} ${m.boost_eligibility_info?.eligible_to_boost ? "✓" : "✗"}`)
        .join(" · ");
    });
  }
  return out;
}
