import { selectBestAudioFile } from "#app/domain/audio-format.ts";
import { type FullTrack } from "#app/types/frontend/shared";
import { type OfflineTrackSummary } from "./types.ts";

export function getOfflineAudioFormat(track: Pick<FullTrack, "audioFiles">): string {
  const best = selectBestAudioFile(track.audioFiles ?? []);
  return best?.format ?? "mp3";
}

export function mimeTypeForAudioFormat(format: string | null | undefined): string {
  switch (format) {
    case "flac":
      return "audio/flac";
    case "wav":
      return "audio/wav";
    case "m4a":
      return "audio/mp4";
    case "ogg":
      return "audio/ogg";
    case "aac":
      return "audio/aac";
    case "webm":
      return "audio/webm";
    case "mp3":
    default:
      return "audio/mpeg";
  }
}

export function offlineSummaryToFullTrack(
  summary: OfflineTrackSummary & { audioFormat?: string | null },
): FullTrack {
  const format = summary.audioFormat ?? "mp3";

  return {
    id: summary.trackId,
    title: summary.title,
    artist: { id: summary.artistId, name: summary.artistName },
    duration: summary.duration,
    coverImage: summary.coverObjectKey ? { objectKey: summary.coverObjectKey } : null,
    audioFiles: [{ id: summary.trackId, format, objectKey: "" }],
  };
}
