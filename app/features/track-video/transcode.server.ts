import { spawn } from "node:child_process";

export type ProbedVideo = {
  /** Container names reported by ffprobe `format_name` (comma-split). */
  formatNames: string[];
  videoCodec: string | null;
  audioCodec: string | null;
};

const MP4_FORMAT_NAMES = new Set(["mp4", "mov"]);
const PROBE_TIMEOUT_MS = 30_000;
const TRANSCODE_TIMEOUT_MS = 15 * 60_000;

/**
 * Canonical format is H.264 + AAC in an MP4 container. A video-only H.264 MP4
 * is accepted too (karaoke audio comes from the track's audio element).
 */
export function isTranscodeCompliant(probed: ProbedVideo): boolean {
  const inMp4 = probed.formatNames.some((n) => MP4_FORMAT_NAMES.has(n));
  if (!inMp4) return false;
  if (probed.videoCodec !== "h264") return false;
  return probed.audioCodec === null || probed.audioCodec === "aac";
}

export function parseFfprobeOutput(stdout: string): ProbedVideo {
  let json: {
    format?: { format_name?: string };
    streams?: Array<{ codec_type?: string; codec_name?: string }>;
  };
  try {
    json = JSON.parse(stdout) as typeof json;
  } catch {
    throw new Error("Unable to parse ffprobe output");
  }
  if (!json || typeof json !== "object" || !json.format) {
    throw new Error("Unable to parse ffprobe output");
  }
  const streams = json.streams ?? [];
  return {
    formatNames: (json.format.format_name ?? "").split(",").filter(Boolean),
    videoCodec: streams.find((s) => s.codec_type === "video")?.codec_name ?? null,
    audioCodec: streams.find((s) => s.codec_type === "audio")?.codec_name ?? null,
  };
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => {
      // Keep only the tail; ffmpeg can be chatty.
      stderr = (stderr + d.toString()).slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} failed (${signal ?? code}): ${stderr.trim()}`));
    });
  });
}

/** Inspect a local file with ffprobe. Rejects if it is not a readable media file. */
export async function probeVideo(filePath: string): Promise<ProbedVideo> {
  const stdout = await run(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
    PROBE_TIMEOUT_MS,
  );
  return parseFfprobeOutput(stdout);
}

/**
 * Transcode to H.264 + AAC MP4 (faststart, so Safari can range-seek). Runs
 * niced with a bounded thread count so it doesn't starve the request loop.
 */
export async function transcodeToCompliantMp4(inputPath: string, outputPath: string) {
  await run(
    "nice",
    [
      "-n",
      "10",
      "ffmpeg",
      "-y",
      "-v",
      "error",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-threads",
      "2",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    TRANSCODE_TIMEOUT_MS,
  );
}
