# Resetting the Database During Development

Use this guide when you **intentionally** want a clean slate — e.g. after schema changes, bad sync data, or before re-testing the full YouTube sync → archive → playback pipeline.

During the dev phase, **backups are not required**. You are wiping data on purpose.

For ongoing production database operations (backups, migrations, monitoring), see [PRODUCTION_DATABASE.md](./PRODUCTION_DATABASE.md).

## What gets wiped

| Target | Command | Effect |
|--------|---------|--------|
| SQLite database | `db:reset:script` | All users, tracks, playlists, archive jobs, etc. Schema recreated from migrations. |
| Tigris storage | `reset-storage` | All audio files and cover images in the bucket. |

These are independent — resetting the DB does **not** clear storage, and vice versa. For a full clean slate, run both.

## Local reset

### 1. Reset the database

```bash
npm run db:reset:script -- --force --seed
```

This runs `prisma migrate reset --force` and seeds the database. The `--force` flag is required (safety guard in `scripts/reset-db.ts`).

Alternative (no wrapper script):

```bash
npm run db:reset
npx prisma db seed
```

### 2. Reset Tigris storage (optional)

Requires Tigris env vars in `.env` (`AWS_ENDPOINT_URL_S3`, `BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`):

```bash
npm run reset-storage
```

### 3. After reset — what you get from seed

Seed creates:

- **Services**: `youtube`, `local`
- **Roles/permissions**: from the init migration (admin, user, etc.)
- **Users**: 5 random users + `kody` (admin, password `kodylovesyou`) + `kodyuser`
- **Tracks**: none (`ENABLE_TRACK_SEEDING = false` in `prisma/seed.ts`)

Seed does **not** recreate your real account or synced playlists. You need to:

1. Sign up / log in again (or use `kody` for local testing)
2. Re-connect YouTube OAuth
3. Re-sync playlists
4. Let the archive worker re-download audio (durations and metadata come from the downloaded files)

To grant admin to an existing user after they sign up:

```bash
npm run make-admin <username>
```

## Production reset (dev phase on Fly.io)

Same intent as local — wipe everything and start fresh. No backup needed if that is deliberate.

App: `music-library-5a00`

### 1. Stop the machine (releases LiteFS locks)

```bash
fly machine stop 7817405c597658 --app music-library-5a00
```

### 2. Reset the database

```bash
fly ssh console --app music-library-5a00 -C "sh -c 'rm -f /litefs/data/sqlite.db /litefs/data/sqlite.db-wal /litefs/data/sqlite.db-shm && cd /myapp && npx prisma migrate deploy && npx prisma db seed'"
```

> `prisma migrate reset` often fails on LiteFS with disk I/O errors while the app is running. Deleting the DB files manually while stopped is the reliable approach.

### 3. Reset Tigris storage

From your local machine (with production Tigris credentials in `.env`, or via Fly secrets):

```bash
npm run reset-storage
```

### 4. Re-grant admin and start the app

Seed creates `kody`, not your production account. After you sign up again:

```bash
fly ssh console --app music-library-5a00 -C "cd /myapp && npx tsx scripts/make-admin.ts lieutner"
```

Then start the machine:

```bash
fly machine start 7817405c597658 --app music-library-5a00
```

### 5. Re-sync

Log in → connect YouTube → sync playlists. Tracks will show `--:--` for duration until the archive worker downloads them.

## Typical full-reset workflow

```bash
# Local
npm run db:reset:script -- --force --seed
npm run reset-storage
# sign up, connect YouTube, sync playlists
```

```bash
# Production (dev phase)
fly machine stop 7817405c597658 --app music-library-5a00
fly ssh console --app music-library-5a00 -C "sh -c 'rm -f /litefs/data/sqlite.db /litefs/data/sqlite.db-wal /litefs/data/sqlite.db-shm && cd /myapp && npx prisma migrate deploy && npx prisma db seed'"
npm run reset-storage   # with prod Tigris creds in .env
fly machine start 7817405c597658 --app music-library-5a00
# sign up, make-admin, connect YouTube, sync playlists
```

## Scripts reference

| Script | npm command | Purpose |
|--------|-------------|---------|
| `scripts/reset-db.ts` | `npm run db:reset:script -- --force [--seed]` | DB reset with safety guard |
| `scripts/reset-storage.ts` | `npm run reset-storage` | Wipe all Tigris objects |
| `scripts/make-admin.ts` | `npm run make-admin <username>` | Grant admin role |
