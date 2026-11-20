import { describe, expect, test } from "vitest";
import { buildYtDlpVideoArgs, fetchYoutubeVideo } from "./youtube-video.server.ts";

const URL_OK = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

describe("buildYtDlpVideoArgs", () => {
  test("fetches video (not audio extraction), merges to mp4, caps size", () => {
    const args = buildYtDlpVideoArgs(URL_OK, { outputDir: "/tmp/x", maxBytes: 1234 });
    expect(args).not.toContain("--extract-audio");
    expect(args).toContain("--no-playlist");
    expect(args).toEqual(expect.arrayContaining(["--merge-output-format", "mp4"]));
    expect(args).toEqual(expect.arrayContaining(["--max-filesize", "1234"]));
    expect(args.at(-1)).toBe(URL_OK);
  });
});

describe("fetchYoutubeVideo SSRF guard", () => {
  test.each([
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://evil.example.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=abc",
    "--exec=whoami",
    "file:///etc/passwd",
  ])("rejects %s without spawning", async (url) => {
    const result = await fetchYoutubeVideo(url, { outputDir: "/tmp/x", maxBytes: 1000 });
    expect(result.ok).toBe(false);
  });
});
