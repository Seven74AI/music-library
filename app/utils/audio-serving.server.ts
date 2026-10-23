import { openSync, readFileSync, readSync, closeSync, statSync } from "node:fs";

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

  const rangeHeader = request.headers.get("Range");

  if (rangeHeader) {
    const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (rangeMatch && rangeMatch[1]) {
      const start = parseInt(rangeMatch[1], 10);
      const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      if (start >= 0 && start < fileSize && end < fileSize && start <= end) {
        const fileBuffer = Buffer.allocUnsafe(chunkSize);
        const fd = openSync(localFilePath, "r");
        readSync(fd, fileBuffer, 0, chunkSize, start);
        closeSync(fd);

        return new Response(fileBuffer, {
          status: 206,
          headers: {
            "Content-Type": mimeType,
            "Content-Length": chunkSize.toString(),
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": cacheControl,
          },
        });
      }
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
