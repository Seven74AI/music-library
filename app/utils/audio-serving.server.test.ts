import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { serveLocalAudioFile } from "./audio-serving.server.ts";

describe("serveLocalAudioFile", () => {
  it("returns 416 when the requested byte range is unsatisfiable", () => {
    const dir = mkdtempSync(join(tmpdir(), "audio-serve-"));
    const filePath = join(dir, "clip.mp3");
    writeFileSync(filePath, Buffer.from([1, 2, 3, 4, 5]));

    const response = serveLocalAudioFile(
      filePath,
      { mimeType: "audio/mpeg" },
      new Request("http://localhost/test", { headers: { Range: "bytes=100-" } }),
      "private, no-store",
    );

    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */5");
  });

  it("clamps an end byte past EOF and still returns 206", () => {
    const dir = mkdtempSync(join(tmpdir(), "audio-serve-"));
    const filePath = join(dir, "clip.mp3");
    writeFileSync(filePath, Buffer.from([1, 2, 3, 4, 5]));

    const response = serveLocalAudioFile(
      filePath,
      { mimeType: "audio/mpeg" },
      new Request("http://localhost/test", { headers: { Range: "bytes=0-999999" } }),
      "private, no-store",
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 0-4/5");
    expect(response.headers.get("Content-Length")).toBe("5");
  });

  it("returns 206 with Content-Length matching bytes read for a valid range", () => {
    const dir = mkdtempSync(join(tmpdir(), "audio-serve-"));
    const filePath = join(dir, "clip.mp3");
    writeFileSync(filePath, Buffer.from([1, 2, 3, 4, 5]));

    const response = serveLocalAudioFile(
      filePath,
      { mimeType: "audio/mpeg" },
      new Request("http://localhost/test", { headers: { Range: "bytes=1-3" } }),
      "private, no-store",
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Length")).toBe("3");
  });
});
