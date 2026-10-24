/**
 * Client-side metadata change payload for track edits (single + bulk).
 *
 * All fields are optional so the same shape serves both full-edit forms
 * (basic/extended tabs, which send title + artistId + everything) and the
 * bulk-edit dialog (which sends only the fields the curator changed).
 * The server validates the actual submitted shape (EditTrackSchema).
 */
export type TrackMetadataChanges = {
  title?: string;
  artistId?: string;
  albumId?: string | null;
  /** Backward-compatible single-genre field. */
  genre?: string | null;
  genreIds?: string[];
  year?: number | null;
  trackNumber?: number | null;
  albumArtist?: string | null;
  bpm?: number | null;
  label?: string | null;
  isrc?: string | null;
  releaseDate?: string | null;
  originalDate?: string | null;
  originalYear?: number | null;
  totalTracks?: number | null;
  totalDiscs?: number | null;
  lyrics?: string | null;
  comment?: string;
};
