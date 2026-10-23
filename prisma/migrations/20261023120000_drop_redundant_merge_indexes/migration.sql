-- Migration 20260927000000_add_edit_history_and_merge_tracking created BOTH
-- `Artist_mergedIntoId_idx` and `Artist_mergedIntoId_fkey_idx` on the same
-- column (and the Album equivalents). The `_fkey_idx` names imply foreign keys
-- that don't exist — they are duplicate single-column indexes, doubling storage
-- and write overhead on every Artist/Album insert/update/delete.
--
-- Drop the redundant pair. `Artist_mergedIntoId_idx` / `Album_mergedIntoId_idx`
-- (from `@@index([mergedIntoId])`) remain.

DROP INDEX IF EXISTS "Artist_mergedIntoId_fkey_idx";
DROP INDEX IF EXISTS "Album_mergedIntoId_fkey_idx";
