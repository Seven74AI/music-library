/**
 * Comment-prefix markers for curator activity classification.
 *
 * Merge and split actions are recorded as `ArtistEdit` / `AlbumEdit` rows whose
 * `comment` carries a distinguishing prefix. The merge/split endpoints
 * (`artists.merge.tsx`, `albums.merge.tsx`, `artists.$id.split.tsx`) are the
 * only writers of these prefixes, but the *readers* (dashboard activity feed
 * and badge metrics) must agree on the same markers or a merge/split is
 * silently miscounted. Keep every prefix in this one module so the read and
 * write sides cannot drift.
 */

export const MERGE_COMMENT_PREFIX = "MERGE:";
export const MERGED_INTO_PREFIX = "Merged into";
export const SPLIT_COMMENT_PREFIX = "SPLIT:";
export const CREATED_VIA_SPLIT_PREFIX = "CREATED via split";

/** A merge action (see `artists.merge.tsx` / `albums.merge.tsx`). */
export function isMergeComment(comment: string | null | undefined): boolean {
  const text = comment ?? "";
  return text.startsWith(MERGE_COMMENT_PREFIX) || text.startsWith(MERGED_INTO_PREFIX);
}

/** A split action (see `artists.$id.split.tsx`). */
export function isSplitComment(comment: string | null | undefined): boolean {
  const text = comment ?? "";
  return text.startsWith(SPLIT_COMMENT_PREFIX) || text.startsWith(CREATED_VIA_SPLIT_PREFIX);
}
