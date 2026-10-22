import { expect, test, vi } from "vitest";
import { sendTelegramMessage } from "#app/features/audio-archive/notification.server.ts";
import { notifyBackupFailed } from "./notification.server.ts";

vi.mock("#app/features/audio-archive/notification.server.ts", () => ({
  sendTelegramMessage: vi.fn(async () => true),
}));

test("notifyBackupFailed sends HTML Telegram with escaped error", async () => {
  await notifyBackupFailed("<script>x</script>", 3);
  expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
  const text = vi.mocked(sendTelegramMessage).mock.calls[0]![0];
  expect(text).toContain("SQLite Backup Failed");
  expect(text).toContain("3 attempt");
  expect(text).toContain("&lt;script&gt;");
  expect(text).not.toContain("<script>");
});
