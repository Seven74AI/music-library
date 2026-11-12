import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { serveLocalAudioFile, serveStorageAudioFile } from "./audio-serving.server.ts";
import * as storageServer from "./storage.server.ts";

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
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
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

describe("serveStorageAudioFile", () => {
  it("returns 206 with Content-Range when storage honors a range request", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([9, 9, 9]));
        controller.close();
      },
    });
    const request = new Request("http://localhost/audio", {
      headers: { Range: "bytes=0-2" },
    });
    const getStream = vi.spyOn(storageServer, "getStorageObjectStream").mockResolvedValue({
      status: 206,
      body: stream,
      contentType: "audio/mpeg",
      contentLength: 3,
      contentRange: "bytes 0-2/100",
    });

    const response = await serveStorageAudioFile(
      "audio/tracks/local/x.mp3",
      { mimeType: "audio/mpeg" },
      request,
      "private, no-store",
    );

    expect(getStream).toHaveBeenCalledWith("audio/tracks/local/x.mp3", request);
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 0-2/100");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    vi.restoreAllMocks();
  });
});
