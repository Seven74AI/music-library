/**
 * Classify playlist memberships that are absent from the current sync response
 * using YouTube videos.list existence results (ADR-005 removal vs deleted matching).
 */

export type AbsentPlaylistTrackRow = {
  sptId: string;
  trackId: string;
  title: string;
  artist: string;
  externalId: string | null;
  position: number;
  isDeleted: boolean;
};

export type VideoExistenceLookup = { status: "ok"; existingIds: Set<string> } | { status: "error" };

export type AbsentTrackClassification = {
  removeSptIds: Set<string>;
  candidateTracks: Array<{
    id: string;
    title: string;
    artist: string;
    externalId: string | null;
    position: number;
    isDeleted: boolean;
  }>;
  leaveAloneSptIds: Set<string>;
};

/** YouTube video ids are 11 chars from [A-Za-z0-9_-]. */
export function isYouTubeVideoId(externalId: string | null | undefined): boolean {
  return typeof externalId === "string" && /^[A-Za-z0-9_-]{11}$/.test(externalId);
}

export function classifyAbsentPlaylistTracks(input: {
  absentTracks: AbsentPlaylistTrackRow[];
  lookup: VideoExistenceLookup;
  hasDeferredDeletedItems: boolean;
}): AbsentTrackClassification {
  const removeSptIds = new Set<string>();
  const leaveAloneSptIds = new Set<string>();
  const candidateTracks: AbsentTrackClassification["candidateTracks"] = [];

  for (const track of input.absentTracks) {
    if (!isYouTubeVideoId(track.externalId)) {
      leaveAloneSptIds.add(track.sptId);
      continue;
    }

    if (input.lookup.status === "error") {
      leaveAloneSptIds.add(track.sptId);
      continue;
    }

    if (input.lookup.existingIds.has(track.externalId!)) {
      removeSptIds.add(track.sptId);
      continue;
    }

    // Gone from YouTube
    if (input.hasDeferredDeletedItems) {
      candidateTracks.push({
        id: track.trackId,
        title: track.title,
        artist: track.artist,
        externalId: track.externalId,
        position: track.position,
        isDeleted: track.isDeleted,
      });
    } else {
      removeSptIds.add(track.sptId);
    }
  }

  return { removeSptIds, candidateTracks, leaveAloneSptIds };
}
