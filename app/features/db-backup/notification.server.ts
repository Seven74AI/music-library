/**
 * Telegram alerts for SQLite backup failures.
 */
import { escapeHtml } from "#app/utils/escape-html.ts";
import { sendTelegramMessage } from "#app/utils/telegram-notification.server.ts";

export async function notifyBackupFailed(
  errorMessage: string,
  attemptCount: number,
): Promise<void> {
  const escaped = escapeHtml(errorMessage);
  await sendTelegramMessage(
    `❌ <b>SQLite Backup Failed</b>\n\n` +
      `Automated database backup failed after ${attemptCount} attempt(s).\n\n` +
      `<b>Error:</b> ${escaped}\n\n` +
      `<i>Check /admin/db-backup and try Backup now.</i>`,
  );
}
