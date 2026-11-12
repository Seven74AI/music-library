import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildAudioObjectKey,
  isUnifiedAudioObjectKey,
  uploadFile,
  uploadProfileImage,
} from "./storage.server";

describe("buildAudioObjectKey", () => {
  it("builds a youtube archive key", () => {
    expect(buildAudioObjectKey("youtube", "clxyz123", "mp3")).toBe(
      "audio/tracks/youtube/clxyz123.mp3",
    );
  });

  it("builds a local upload key", () => {
    expect(buildAudioObjectKey("local", "clabc456", "flac")).toBe(
      "audio/tracks/local/clabc456.flac",
    );
  });

  it("normalizes extension (strip dot, lowercase)", () => {
    expect(buildAudioObjectKey("youtube", "track-1", ".MP3")).toBe(
      "audio/tracks/youtube/track-1.mp3",
    );
  });

  it("throws when required params are missing", () => {
    expect(() => buildAudioObjectKey("", "track-1", "mp3")).toThrow();
    expect(() => buildAudioObjectKey("youtube", "", "mp3")).toThrow();
    expect(() => buildAudioObjectKey("youtube", "track-1", "")).toThrow();
  });
});

describe("isUnifiedAudioObjectKey", () => {
  it("returns true for unified keys", () => {
    expect(isUnifiedAudioObjectKey("audio/tracks/youtube/clxyz123.mp3")).toBe(true);
    expect(isUnifiedAudioObjectKey("audio/tracks/local/clabc456.flac")).toBe(true);
  });

  it("returns false for legacy archive keys", () => {
    expect(isUnifiedAudioObjectKey("audio/clxyz123/my-video.mp3")).toBe(false);
  });

  it("returns false for legacy upload keys", () => {
    expect(
      isUnifiedAudioObjectKey("audio/tracks/clabc456/clservice123/mp3/1730000000-fileid.mp3"),
    ).toBe(false);
  });
});

describe("uploadFile mock path", () => {
  const originalMocks = process.env.MOCKS;

  beforeEach(() => {
    process.env.MOCKS = "true";
  });

  afterEach(() => {
    if (originalMocks === undefined) {
      delete process.env.MOCKS;
    } else {
      process.env.MOCKS = originalMocks;
    }
  });

  it("returns the key without uploading when MOCKS=true", async () => {
    const key = "audio/tracks/youtube/track-1.mp3";
    await expect(
      uploadFile({
        file: Buffer.from("fake-audio"),
        key,
        contentType: "audio/mpeg",
      }),
    ).resolves.toBe(key);
  });
});

describe("local upload path safety", () => {
  const envSnapshot = {
    MOCKS: process.env.MOCKS,
    AWS_ENDPOINT_URL_S3: process.env.AWS_ENDPOINT_URL_S3,
    BUCKET_NAME: process.env.BUCKET_NAME,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_REGION: process.env.AWS_REGION,
  };
  const uploadedRoot = join(process.cwd(), "tests", "fixtures", "uploaded");
  const traversalProbePath = join(process.cwd(), "tmp", "pwned-round22");

  beforeEach(() => {
    delete process.env.MOCKS;
    delete process.env.AWS_ENDPOINT_URL_S3;
    delete process.env.BUCKET_NAME;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_REGION;
    if (existsSync(traversalProbePath)) {
      rmSync(traversalProbePath, { force: true });
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    if (existsSync(traversalProbePath)) {
      rmSync(traversalProbePath, { force: true });
    }
  });

  it("rejects profile image filenames that attempt path traversal", async () => {
    const malicious = new File(
      [Uint8Array.from([0xff, 0xd8, 0xff])],
      "avatar.jpg/../../../tmp/pwned-round22",
      {
        type: "image/jpeg",
      },
    );

    await expect(uploadProfileImage("user-round22", malicious)).rejects.toThrow();
    expect(existsSync(traversalProbePath)).toBe(false);
  });

  it("uploads a valid profile image under the local upload root", async () => {
    const photo = new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], "avatar.png", {
      type: "image/png",
    });

    const key = await uploadProfileImage("user-round22-valid", photo);
    expect(key).toMatch(/^images\/profile-images\/user-round22-valid\//);

    const absolutePath = join(uploadedRoot, key);
    expect(existsSync(absolutePath)).toBe(true);
    expect(absolutePath.startsWith(uploadedRoot)).toBe(true);

    rmSync(absolutePath, { force: true });
  });

  it("refuses uploadFile keys that escape the upload directory", async () => {
    const escapeKey = "images/safe-prefix/../../tmp/pwned-round22";

    await expect(
      uploadFile({
        file: Buffer.from("not-a-real-image"),
        key: escapeKey,
        contentType: "image/jpeg",
      }),
    ).rejects.toThrow();

    expect(existsSync(traversalProbePath)).toBe(false);
  });
});
