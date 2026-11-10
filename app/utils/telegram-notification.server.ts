const TELEGRAM_API_BASE = "https://api.telegram.org";

interface TelegramResponse {
  ok: boolean;
  result?: unknown;
  description?: string;
}

/**
 * Send a raw Telegram message to the admin chat.
 * Returns true if the message was sent successfully.
 * Silently fails if TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID
 * are not configured (returns false, no throw).
 */
export async function sendTelegramMessage(text: string): Promise<boolean> {
  if (process.env.MOCKS === "true") return true;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (!token || !chatId) return false;

  try {
    const url = `${TELEGRAM_API_BASE}/bot${token}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
    });

    const data = (await response.json()) as TelegramResponse;

    return data.ok === true;
  } catch {
    return false;
  }
}
