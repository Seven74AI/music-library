# ADR-029: SQLite Off-Volume Backups

## Status

Accepted

**Date:** 2026-09-28

## Context

Production SQLite lives on a Fly volume behind LiteFS (`/litefs/data/sqlite.db`). LiteFS provides
failover across machines that share that volume topology, but it is **not** an off-platform backup.
Existing ops docs suggested copying the DB onto `/litefs/data/backups`, which fails for volume loss.
Audio/covers live in Tigris and are out of scope for this ADR (media snapshots deferred).

Failure modes we care about in v1:

1. Fly volume / machine loss
2. Human or software mistakes (bad migrate, accidental wipe)

## Decision

- Take consistent snapshots with **`litefs export`** (not raw `cp`); restore with **`litefs import`**.
- Upload to a **separate Tigris bucket** (`BACKUP_BUCKET_NAME`), same AWS/Tigris credentials as media.
- Retention: **7 daily** + **4 weekly** objects (~30 days).
- Keys: `backups/sqlite/daily/YYYY-MM-DD.db`, `backups/sqlite/weekly/YYYY-Www.db`.
- **In-app scheduler** on the LiteFS primary (~`BACKUP_HOUR_UTC`, default 03:00 UTC), with same-day
  retries then Telegram alert; gated when `BACKUP_BUCKET_NAME` is unset.
- **Admin UI** at `/admin/db-backup`: last success/failure + **Backup now**. No in-app restore.
- Persist attempt outcomes in a singleton **`BackupState`** row; objects in the backup bucket are
  the recoverables.
- Scope: **`sqlite.db` only**. Re-upload YouTube cookies after restore. Do not back up `cache.db`.
- Ops: `scripts/manage-db.ts backup|restore` + `docs/PRODUCTION_DATABASE.md`.

## Consequences

- Creating/configuring `BACKUP_BUCKET_NAME` is a manual Fly/Tigris step before automation runs.
- Weekly keys duplicate the same day's export under a longer retention tier (extra object, simple prune).
- Media (Tigris audio/covers) protection remains a separate concern (e.g. Tigris snapshots later).

## Rejected for v1

- Litestream continuous replication alongside LiteFS
- Backing up cookies / openimg cache / `cache.db`
- Second full copy of media objects
- One-click UI restore or CI restore drills
- On-volume-only backup directories as the primary strategy
