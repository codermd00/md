/** إشعار Telegram — التوكن ومعرّف الدردشة من متغيرات البيئة فقط. لا يفشل أبداً (يعيد false). */
export async function sendTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    });
    return res.ok;
  } catch { return false; }
}

export async function notifyEnabled(db: any, key: "notify_new_post" | "notify_run_done" | "notify_error"): Promise<boolean> {
  const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  return data ? data.value !== false : true;
}
