import { spawn } from "node:child_process";
import {
  isAllowedArchiveDownloadUrl,
  resolveContainedOutputPath,
} from "#app/features/audio-archive/yt-dlp.server.ts";

const FETCH_TIMEOUT_MS = 15 * 60_000;

export type YoutubeVideoFetchOptions = {
  outputDir: string;
  /** Hard cap passed to yt-dlp `--max-filesize`. */
  maxBytes: number;
  cookieFile?: string;
  timeoutMs?: number;
};

export type YoutubeVideoFetchResult = { ok: true; filePath: string } | { ok: false; error: string };

/**
 * yt-dlp args for a VIDEO fetch (no `--extract-audio`). Prefers H.264/AAC so
 * the ingest step can usually pass the file through without transcoding.
 * The caller must have validated `url` with `isAllowedArchiveDownloadUrl`.
 */
export function buildYtDlpVideoArgs(
  url: string,
  options: Pick<YoutubeVideoFetchOptions, "outputDir" | "maxBytes" | "cookieFile">,
): string[] {
  const args = [
    "--no-playlist",
    "-f",
    "bv*[vcodec^=avc1][height<=1080]+ba[ext=m4a]/b[ext=mp4][vcodec^=avc1]/bv*[height<=1080]+ba/b",
    "--merge-output-format",
    "mp4",
    "--max-filesize",
    String(options.maxBytes),
    "--js-runtimes",
    `node:${process.execPath}`,
    "--paths",
    options.outputDir,
    "--output",
    "%(id)s.%(ext)s",
    "--print",
    "after_move:filepath",
    "--no-simulate",
  ];
  if (options.cookieFile) args.push("--cookies", options.cookieFile);
  args.push(url);
  return args;
}

/**
 * Download a YouTube video via yt-dlp. Reuses the audio-archive SSRF guard
 * (canonical watch URLs only); the allowlist is intentionally not loosened.
 * YouTube often bot-walls datacenter IPs — callers should fall back to upload.
 */
export async function fetchYoutubeVideo(
  url: string,
  options: YoutubeVideoFetchOptions,
): Promise<YoutubeVideoFetchResult> {
  if (!isAllowedArchiveDownloadUrl(url)) {
    return {
      ok: false,
      error: "Refusing to download a URL that is not an allowed YouTube watch URL",
    };
  }
  if (process.env.MOCKS === "true") {
    return { ok: false, error: "YouTube video fetch is disabled in mocks mode" };
  }

  const args = buildYtDlpVideoArgs(url, options);
  return new Promise((resolve) => {
    const child = spawn("yt-dlp", args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeoutMs ?? FETCH_TIMEOUT_MS,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)));
    child.on("error", (err) => resolve({ ok: false, error: err.message }));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve({ ok: false, error: stderr.trim() || `yt-dlp exited with code ${code}` });
        return;
      }
      const printed = stdout.trim().split("\n").at(-1)?.trim();
      const filePath = printed ? resolveContainedOutputPath(printed, options.outputDir) : undefined;
      if (!filePath) {
        resolve({ ok: false, error: "yt-dlp did not report an output file inside the output dir" });
        return;
      }
      resolve({ ok: true, filePath });
    });
  });
}
