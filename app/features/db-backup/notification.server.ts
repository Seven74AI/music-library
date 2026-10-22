/**
 * Telegram alerts for SQLite backup failures.
 */
import { sendTelegramMessage } from "#app/features/audio-archive/notification.server.ts";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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
