import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  isTranscodeCompliant,
  parseFfprobeOutput,
  probeVideo,
  transcodeToCompliantMp4,
} from "./transcode.server.ts";

describe("isTranscodeCompliant", () => {
  const base = { formatNames: ["mov", "mp4", "m4a"], videoCodec: "h264", audioCodec: "aac" };

  test("H.264 + AAC in MP4 is compliant", () => {
    expect(isTranscodeCompliant(base)).toBe(true);
  });

  test("H.264 MP4 with no audio track is compliant", () => {
    expect(isTranscodeCompliant({ ...base, audioCodec: null })).toBe(true);
  });

  test("VP9 is not compliant", () => {
    expect(isTranscodeCompliant({ ...base, videoCodec: "vp9" })).toBe(false);
  });

  test("non-AAC audio is not compliant", () => {
    expect(isTranscodeCompliant({ ...base, audioCodec: "opus" })).toBe(false);
  });

  test("H.264 in MKV/WebM container is not compliant", () => {
    expect(isTranscodeCompliant({ ...base, formatNames: ["matroska", "webm"] })).toBe(false);
  });

  test("missing video stream is not compliant", () => {
    expect(isTranscodeCompliant({ ...base, videoCodec: null })).toBe(false);
  });
});

describe("parseFfprobeOutput", () => {
  test("extracts container and codecs", () => {
    const parsed = parseFfprobeOutput(
      JSON.stringify({
        format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
        streams: [
          { codec_type: "video", codec_name: "h264" },
          { codec_type: "audio", codec_name: "aac" },
        ],
      }),
    );
    expect(parsed).toEqual({
      formatNames: ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"],
      videoCodec: "h264",
      audioCodec: "aac",
    });
  });

  test("throws on garbage", () => {
    expect(() => parseFfprobeOutput("nope")).toThrow();
  });
});

describe("ffmpeg integration", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "karaoke-transcode-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function makeSource(name: string, args: string[]) {
    const out = join(dir, name);
    const result = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc=duration=1:size=160x120:rate=10",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=1",
        ...args,
        out,
      ],
      { stdio: "ignore" },
    );
    expect(result.status).toBe(0);
    return out;
  }

  test("probeVideo reports a compliant source and transcode yields compliant MP4", async () => {
    const webm = makeSource("src.webm", ["-c:v", "libvpx", "-c:a", "libvorbis"]);
    const probed = await probeVideo(webm);
    expect(probed.videoCodec).toBe("vp8");
    expect(isTranscodeCompliant(probed)).toBe(false);

    const out = join(dir, "out.mp4");
    await transcodeToCompliantMp4(webm, out);
    expect(statSync(out).size).toBeGreaterThan(0);
    expect(isTranscodeCompliant(await probeVideo(out))).toBe(true);
  }, 60_000);

  test("probeVideo recognises an H.264 + AAC MP4 as compliant", async () => {
    const mp4 = makeSource("ok.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"]);
    expect(isTranscodeCompliant(await probeVideo(mp4))).toBe(true);
  }, 60_000);
});
