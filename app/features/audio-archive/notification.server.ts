/**
 * Telegram notification service for audio archive alerts.
 *
 * Sends alerts to the admin chat when:
 * - A cookie is detected as expired/invalid (403 or sign-in required)
 * - A job fails permanently (non-retriable error)
 * - The worker auto-pauses due to cookie expiry
 */

import { escapeHtml } from "#app/utils/escape-html.ts";
import { sendTelegramMessage } from "#app/utils/telegram-notification.server.ts";

export { sendTelegramMessage };

/**
 * Notify admin that the archive worker auto-paused after repeated cookie failures.
 */
export async function notifyWorkerPausedForCookies(consecutiveFailures: number): Promise<void> {
  await sendTelegramMessage(
    `⏸️ <b>Archive Queue Paused</b>\n\n` +
      `The worker paused after ${consecutiveFailures} consecutive cookie expired errors.\n\n` +
      `<i>Upload a fresh cookie at /admin/youtube-cookies,\n` +
      `then resume the queue at /admin/audio-queue.</i>`,
  );
}

/**
 * Notify admin that the YouTube cookie appears to be expired or invalid.
 * Triggered when yt-dlp returns a 403 AUTH error or COOKIE_EXPIRED error.
 */
export async function notifyCookieExpired(
  jobId: string,
  trackUrl: string,
  errorMessage: string,
): Promise<void> {
  const escaped = escapeHtml(trackUrl);
  const escapedErr = escapeHtml(errorMessage);

  await sendTelegramMessage(
    `⚠️ <b>YouTube Cookie Expired</b>\n\n` +
      `The active YouTube cookie was rejected by yt-dlp.\n\n` +
      `<b>Job:</b> ${jobId}\n` +
      `<b>URL:</b> ${escaped}\n` +
      `<b>Error:</b> ${escapedErr}\n\n` +
      `<i>Upload a fresh cookie at /admin/youtube-cookies\nto resume archiving.</i>`,
  );
}

/**
 * Notify admin that a job has permanently failed.
 * Non-retriable errors: GEO_BLOCKED, VIDEO_UNAVAILABLE, etc.
 */
export async function notifyJobFailed(
  jobId: string,
  trackUrl: string,
  errorCategory: string,
  errorMessage: string,
): Promise<void> {
  const escaped = escapeHtml(trackUrl);
  const escapedErr = escapeHtml(errorMessage);
  const escapedCat = escapeHtml(errorCategory);

  await sendTelegramMessage(
    `❌ <b>Archive Job Failed</b>\n\n` +
      `<b>Job:</b> ${jobId}\n` +
      `<b>URL:</b> ${escaped}\n` +
      `<b>Category:</b> ${escapedCat}\n` +
      `<b>Error:</b> ${escapedErr}`,
  );
}
