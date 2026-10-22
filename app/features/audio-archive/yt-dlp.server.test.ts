import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildYtDlpArgs,
  buildYtDlpSpawnArgs,
  executeYtDlp,
  extractFilePath,
  categorizeStderr,
  categorizeYtDlpError,
  parseYtDlpProgress,
} from "./yt-dlp.server.ts";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

describe("buildYtDlpSpawnArgs", () => {
  const url = "https://youtube.com/watch?v=abc123";

  it("includes node JS runtime for YouTube challenge solving", () => {
    const args = buildYtDlpSpawnArgs(url);
    expect(args).toContain("--js-runtimes");
    const runtimeIndex = args.indexOf("--js-runtimes");
    expect(args[runtimeIndex + 1]).toBe(`node:${process.execPath}`);
  });

  it("passes cookie file when provided", () => {
    const args = buildYtDlpSpawnArgs(url, {
      cookieFile: "/data/youtube-cookies.txt",
    });
    expect(args).toContain("--cookies");
    expect(args).toContain("/data/youtube-cookies.txt");
  });

  it("omits cookie flag when cookie file is not provided", () => {
    const args = buildYtDlpSpawnArgs(url);
    expect(args).not.toContain("--cookies");
  });

  it("includes output directory when provided", () => {
    const args = buildYtDlpSpawnArgs(url, { outputDir: "/tmp/downloads" });
    expect(args).toContain("--paths");
    expect(args).toContain("/tmp/downloads");
  });

  it("uses video id for the default output template", () => {
    const outputIndex = buildYtDlpSpawnArgs(url).indexOf("--output");
    expect(buildYtDlpSpawnArgs(url)[outputIndex + 1]).toBe("%(id)s.%(ext)s");
  });

  it("prefers best audio format so yt-dlp resolves formats after JS challenge", () => {
    const args = buildYtDlpSpawnArgs(url);
    expect(args).toContain("-f");
    const formatIndex = args.indexOf("-f");
    expect(args[formatIndex + 1]).toBe("bestaudio/best");
  });

  it("passes the URL as one argv element", () => {
    const watchUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const args = buildYtDlpSpawnArgs(watchUrl, { outputDir: "/tmp/downloads" });
    expect(args.at(-1)).toBe(watchUrl);
    expect(args.filter((arg) => arg === watchUrl)).toHaveLength(1);
  });
});

describe("executeYtDlp URL guard", () => {
  let originalMocks: string | undefined;

  beforeEach(() => {
    originalMocks = process.env.MOCKS;
    process.env.MOCKS = "false";
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => {
      throw new Error("refusing to spawn yt-dlp in tests");
    });
  });

  afterEach(() => {
    if (originalMocks === undefined) delete process.env.MOCKS;
    else process.env.MOCKS = originalMocks;
  });

  it("does not spawn yt-dlp for a non-YouTube URL", async () => {
    const result = await executeYtDlp("https://example.com/watch?v=dQw4w9WgXcQ");

    expect(spawnMock).not.toHaveBeenCalled();
    expect(result.exitCode).not.toBe(0);
    expect(result.filePath).toBeUndefined();
  });

  it("does not spawn yt-dlp for a dash-leading string", async () => {
    const result = await executeYtDlp("-https://youtube.com/watch?v=dQw4w9WgXcQ");

    expect(spawnMock).not.toHaveBeenCalled();
    expect(result.exitCode).not.toBe(0);
    expect(result.filePath).toBeUndefined();
  });

  it("does not spawn yt-dlp for a YouTube URL with userinfo", async () => {
    const result = await executeYtDlp("https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ");

    expect(spawnMock).not.toHaveBeenCalled();
    expect(result.exitCode).not.toBe(0);
    expect(result.filePath).toBeUndefined();
  });

  it("spawns an allowed watch URL as one argv element without a shell", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "yt-dlp-allowed-"));
    const filePath = path.join(tempDir, "dQw4w9WgXcQ.mp3");
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = stdout;
    child.stderr = stderr;
    spawnMock.mockImplementation(() => child);

    try {
      const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
      const pending = executeYtDlp(url, { outputDir: tempDir });
      stdout.emit("data", Buffer.from(`[ExtractAudio] Destination: ${filePath}\n`));
      child.emit("close", 0);
      const result = await pending;

      expect(spawnMock).toHaveBeenCalledTimes(1);
      const [command, args, options] = spawnMock.mock.calls[0] as [
        string,
        string[],
        { shell?: boolean },
      ];
      expect(command).toBe("yt-dlp");
      expect(options?.shell).toBeFalsy();
      expect(args.at(-1)).toBe(url);
      expect(args.filter((arg) => arg === url)).toHaveLength(1);
      expect(result.filePath).toBe(path.resolve(filePath));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("extractFilePath", () => {
  it("prefers the final ExtractAudio mp3 over the intermediate webm download", () => {
    const stdout = [
      "[download] Destination: A$AP Rocky - M'$ (Official Audio) [h_L3P4ddEsk].webm",
      "[ExtractAudio] Destination: /tmp/h_L3P4ddEsk.mp3",
    ].join("\n");

    expect(extractFilePath(stdout)).toBe("/tmp/h_L3P4ddEsk.mp3");
  });

  it("resolves relative ExtractAudio paths against the output directory", () => {
    const stdout = "[ExtractAudio] Destination: h_L3P4ddEsk.mp3";
    expect(extractFilePath(stdout, "/tmp/archive")).toBe("/tmp/archive/h_L3P4ddEsk.mp3");
  });

  it("accepts an output path inside the temp directory", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "yt-dlp-inside-"));
    try {
      const inside = path.join(tempDir, "dQw4w9WgXcQ.mp3");
      const stdout = `[ExtractAudio] Destination: ${inside}`;
      expect(extractFilePath(stdout, tempDir)).toBe(path.resolve(inside));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects an output path outside the temp directory", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "yt-dlp-outside-"));
    try {
      const outside = path.resolve(tempDir, "..", "outside-archive.mp3");
      const sibling = `${tempDir}-evil/file.mp3`;
      expect(extractFilePath(`[ExtractAudio] Destination: ${outside}`, tempDir)).toBeUndefined();
      expect(
        extractFilePath("[ExtractAudio] Destination: ../outside-archive.mp3", tempDir),
      ).toBeUndefined();
      expect(extractFilePath(`[ExtractAudio] Destination: ${sibling}`, tempDir)).toBeUndefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("buildYtDlpArgs", () => {
  it("prefixes spawn args with yt-dlp command", () => {
    const url = "https://youtube.com/watch?v=abc123";
    expect(buildYtDlpArgs(url)[0]).toBe("yt-dlp");
    expect(buildYtDlpArgs(url).slice(1)).toEqual(buildYtDlpSpawnArgs(url));
  });
});

describe("categorizeYtDlpError", () => {
  it("categorizes exit code 0 as no error", () => {
    const result = categorizeYtDlpError({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    expect(result.errorCategory).toBeNull();
    expect(result.errorMessage).toBeNull();
  });

  it("categorizes exit code 1 as UNKNOWN for generic errors", () => {
    const result = categorizeYtDlpError({
      exitCode: 1,
      stdout: "",
      stderr: "ERROR: something went wrong",
    });
    expect(result.errorCategory).toBe("UNKNOWN");
    expect(result.errorMessage).toContain("something went wrong");
  });

  it("detects CDN-level 403 as NETWORK (not AUTH)", () => {
    const result = categorizeYtDlpError({
      exitCode: 1,
      stdout: "",
      stderr: "ERROR: unable to download video data: HTTP Error 403: Forbidden",
    });
    expect(result.errorCategory).toBe("NETWORK");
  });

  it("detects auth 403 from webpage fetch as AUTH", () => {
    const result = categorizeYtDlpError({
      exitCode: 1,
      stdout: "",
      stderr:
        "ERROR: Unable to download webpage: HTTP Error 403: Forbidden (caused by <HTTPError 403: Forbidden>)",
    });
    expect(result.errorCategory).toBe("AUTH");
  });

  it("detects rate limiting from stderr", () => {
    const result = categorizeYtDlpError({
      exitCode: 1,
      stdout: "",
      stderr:
        "ERROR: Unable to download webpage: HTTP Error 429: Too Many Requests (caused by <HTTPError 429: Too Many Requests>)",
    });
    expect(result.errorCategory).toBe("RATE_LIMITED");
  });

  it("detects geo-blocked from stderr", () => {
    const result = categorizeYtDlpError({
      exitCode: 1,
      stdout: "",
      stderr: "ERROR: Video unavailable. This video is not available in your country",
    });
    expect(result.errorCategory).toBe("GEO_BLOCKED");
  });

  it("detects video unavailable from stderr", () => {
    const result = categorizeYtDlpError({
      exitCode: 1,
      stdout: "",
      stderr: "ERROR: Video unavailable. This video has been removed by the uploader",
    });
    expect(result.errorCategory).toBe("VIDEO_UNAVAILABLE");
  });

  it("detects network errors from stderr", () => {
    const result = categorizeYtDlpError({
      exitCode: 1,
      stdout: "",
      stderr:
        "ERROR: Unable to connect to server: <urlopen error [Errno -3] Temporary failure in name resolution>",
    });
    expect(result.errorCategory).toBe("NETWORK");
  });

  it("detects cookie/signin errors from stderr", () => {
    const result = categorizeYtDlpError({
      exitCode: 1,
      stdout: "",
      stderr: "ERROR: Sign in to confirm you're not a bot",
    });
    expect(result.errorCategory).toBe("COOKIE_EXPIRED");
  });

  it("detects missing audio formats before generic 403 auth errors", () => {
    const result = categorizeYtDlpError({
      exitCode: 1,
      stdout: "",
      stderr: [
        "WARNING: Unable to download API page: HTTP Error 403: Forbidden",
        "WARNING: Only images are available for download. use --list-formats to see them",
        "ERROR: [youtube] LP8lXGHotpE: Requested format is not available. Use --list-formats for a list of available formats",
      ].join("\n"),
    });
    expect(result.errorCategory).toBe("FORMAT_UNAVAILABLE");
  });

  it("falls back to UNKNOWN for unrecognized errors", () => {
    const result = categorizeYtDlpError({
      exitCode: 1,
      stdout: "",
      stderr: "ERROR: some completely new error message",
    });
    expect(result.errorCategory).toBe("UNKNOWN");
  });

  it("handles empty stderr gracefully", () => {
    const result = categorizeYtDlpError({
      exitCode: 1,
      stdout: "",
      stderr: "",
    });
    expect(result.errorCategory).toBe("UNKNOWN");
  });
});

describe("categorizeStderr", () => {
  it("returns null for empty stderr", () => {
    expect(categorizeStderr("")).toBeNull();
  });

  it("returns null for whitespace-only stderr", () => {
    expect(categorizeStderr("   \n  \t  ")).toBeNull();
  });

  it("detects auth from generic 403 errors", () => {
    expect(categorizeStderr("HTTP Error 403: Forbidden")).toBe("AUTH");
  });

  it("detects CDN 403 as network (video data download blocked)", () => {
    expect(
      categorizeStderr("ERROR: unable to download video data: HTTP Error 403: Forbidden"),
    ).toBe("NETWORK");
  });

  it("detects rate limiting from 429", () => {
    expect(categorizeStderr("HTTP Error 429: Too Many Requests")).toBe("RATE_LIMITED");
  });

  it("detects geo-blocked from country not available", () => {
    expect(categorizeStderr("not available in your country")).toBe("GEO_BLOCKED");
  });

  it("detects video unavailable from removed", () => {
    expect(categorizeStderr("Video unavailable. This video has been removed")).toBe(
      "VIDEO_UNAVAILABLE",
    );
  });

  it("detects video unavailable from private", () => {
    expect(categorizeStderr("Video unavailable. This video is private")).toBe("VIDEO_UNAVAILABLE");
  });

  it("detects network errors from connection failures", () => {
    expect(categorizeStderr("Unable to connect to server")).toBe("NETWORK");
  });

  it("detects network errors from DNS failures", () => {
    expect(categorizeStderr("Temporary failure in name resolution")).toBe("NETWORK");
  });

  it("detects cookie-expired from sign-in required", () => {
    expect(categorizeStderr("Sign in to confirm")).toBe("COOKIE_EXPIRED");
  });

  it("detects format unavailable from storyboard-only responses", () => {
    expect(
      categorizeStderr(
        "WARNING: Only images are available for download\nERROR: Requested format is not available",
      ),
    ).toBe("FORMAT_UNAVAILABLE");
  });
});

describe("parseYtDlpProgress", () => {
  it("returns null when no percentage found", () => {
    expect(parseYtDlpProgress("some random output")).toBeNull();
  });

  it("parses percentage from download progress", () => {
    expect(parseYtDlpProgress("[download]  42.5% of 10.00MiB at 2.00MiB/s")).toBe(42.5);
  });

  it("parses 100% from completion", () => {
    expect(parseYtDlpProgress("[download] 100% of 10.00MiB in 00:05")).toBe(100);
  });

  it("parses 0%", () => {
    expect(parseYtDlpProgress("[download]   0.0% of 10.00MiB")).toBe(0);
  });

  it("handles float-like percentages", () => {
    expect(parseYtDlpProgress("[download]  99.9% of 50.00MiB")).toBe(99.9);
  });
});
