import { openSync, readFileSync, readSync, closeSync, statSync } from "node:fs";
import { parseByteRangeHeader } from "#app/utils/http-byte-range.server.ts";
import { getStorageObjectStream } from "#app/utils/storage.server.ts";

/**
 * Serve a local audio file with naive HTTP Range support.
 *
 * Returns a 206 partial response when a valid `Range` header is present,
 * otherwise a 200 with the full buffer. Shared by the resources/audition/party
 * room audio routes so the stat + range-parse + read logic lives in one place.
 *
 * `cacheControl` differs per route (public for the user library, private for
 * audition grants and room speaker streams), so it is passed in by the caller.
 */
export function serveLocalAudioFile(
  localFilePath: string,
  audioFile: { mimeType: string | null },
  request: Request,
  cacheControl: string,
): Response {
  const mimeType = audioFile.mimeType || "audio/flac";
  const fileStats = statSync(localFilePath);
  const fileSize = fileStats.size;

  const parsedRange = parseByteRangeHeader(request.headers.get("Range"), fileSize);

  if (parsedRange.kind === "unsatisfiable") {
    return new Response("Requested range not satisfiable", {
      status: 416,
      headers: {
        "Content-Range": `bytes */${fileSize}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": cacheControl,
      },
    });
  }

  if (parsedRange.kind === "partial") {
    const { start, end } = parsedRange;
    const chunkSize = end - start + 1;
    const fileBuffer = Buffer.alloc(chunkSize);
    const fd = openSync(localFilePath, "r");
    try {
      const bytesRead = readSync(fd, fileBuffer, 0, chunkSize, start);
      const body = bytesRead === chunkSize ? fileBuffer : fileBuffer.subarray(0, bytesRead);
      return new Response(body, {
        status: 206,
        headers: {
          "Content-Type": mimeType,
          "Content-Length": bytesRead.toString(),
          "Content-Range": `bytes ${start}-${start + bytesRead - 1}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": cacheControl,
        },
      });
    } finally {
      closeSync(fd);
    }
  }

  const fileBuffer = readFileSync(localFilePath);

  return new Response(fileBuffer, {
    headers: {
      "Content-Type": mimeType,
      "Content-Length": fileSize.toString(),
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheControl,
    },
  });
}

/** Stream an object from remote storage with the same Range rules as {@link serveLocalAudioFile}. */
export async function serveStorageAudioFile(
  key: string,
  audioFile: { mimeType: string | null },
  request: Request,
  cacheControl: string,
): Promise<Response> {
  const mimeType = audioFile.mimeType || "audio/flac";
  const stream = await getStorageObjectStream(key, request);

  if (stream.status === 416) {
    return new Response("Requested range not satisfiable", {
      status: 416,
      headers: {
        "Content-Range": `bytes */${stream.fileSize}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": cacheControl,
      },
    });
  }

  return new Response(stream.body, {
    status: stream.status,
    headers: {
      "Content-Type": stream.contentType || mimeType,
      ...(stream.contentLength != null
        ? { "Content-Length": stream.contentLength.toString() }
        : {}),
      ...(stream.contentRange ? { "Content-Range": stream.contentRange } : {}),
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheControl,
    },
  });
}
