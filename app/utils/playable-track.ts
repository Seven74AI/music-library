export type PlayableTrackCandidate = {
  audioFiles?: Array<{ id: string; format: string | null; objectKey: string }>;
  isDeleted?: boolean;
};

export function isPlayableTrack(track: PlayableTrackCandidate): boolean {
  if (track.isDeleted) return false;
  return (track.audioFiles?.length ?? 0) > 0;
}

export function filterPlayableTracks<T extends PlayableTrackCandidate>(tracks: T[]): T[] {
  return tracks.filter(isPlayableTrack);
}
