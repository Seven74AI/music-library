# Resetting the Production DB During Development

Use this guide when you intentionally want to wipe the **production** Fly.io environment and rebuild it from migrations for another round of development testing.

No backup is needed if the wipe is deliberate.

For normal production database operations such as backups, one-off queries, or maintenance, see `docs/PRODUCTION_DATABASE.md`.

## Scope

This procedure resets two independent things:

| Target                        | Effect                                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| SQLite database on Fly volume | Deletes all users, tracks, playlists, archive jobs, OAuth connections, etc. Schema is recreated from committed Prisma migrations. |
| Tigris storage                | Deletes all archived audio files and cover images.                                                                                |

For a true clean slate, do both.

## Why no seed

Do **not** run `prisma db seed` on production.

- The production Docker image does not include `tests/db-utils.ts`, so seed fails there.
- Production does not need seed data to boot.
- Prisma migrations already create the schema and the core reference data the app needs.

After the reset, you sign up again, grant admin again, reconnect YouTube, and re-sync playlists.

## Preferred approach

On Fly + LiteFS, the cleanest reset is to **replace the attached volume** instead of trying to delete `sqlite.db` in place.

Use `fly machine clone`: when the source machine has a volume, Fly provisions a **new empty volume** on the clone ([Fly docs](https://fly.io/docs/flyctl/machine-clone/)). You then destroy the old machine and its leftover volume.

Per [Fly volume management](https://fly.io/docs/volumes/volume-manage/), volumes attached to a machine cannot be destroyed until that machine is stopped and destroyed. Some Fly blueprints show `stop → destroy volume → create volume → start` on the **same** machine ID; that only works after the machine no longer holds the volume binding.

This avoids:

- LiteFS file locking / file recreation issues
- `prisma migrate reset` / `P3016`
- SSH-while-stopped confusion
- temporary command overrides that can accidentally wipe the DB again on restart
- trying to destroy a volume while it is still bound to a machine

## Before you start

Discover the current machine ID and attached volume ID:

```bash
fly machine list --app [APP_NAME]
fly volumes list --app [APP_NAME]
```

From `fly.toml` and current Fly state:

- app: `[APP_NAME]` (`app` in `fly.toml`)
- volume name: `data` (`[mounts].source` in `fly.toml`)
- region: `cdg` (`primary_region` in `fly.toml`)
- volume size: `1GB`

In the commands below, replace:

- `[APP_NAME]` with your Fly app name

- `<machine-id>` with the current Fly machine ID
- `<new-machine-id>` with the ID returned by `fly machine clone`
- `<volume-id>` with the old `data` volume ID (the one attached to `<machine-id>`)

## Reset procedure

### 1. Clone the machine

Creates a new machine with a fresh empty `data` volume.

```bash
fly machine clone <machine-id> --region cdg --app [APP_NAME]
```

Add `--detach` to return immediately instead of waiting for health checks.

Note the new machine ID from the output (e.g. `Machine <new-machine-id> has been created`).

The clone command may block on health checks while the old machine still exists. That is expected — continue with step 2 in another terminal as soon as the clone is created.

### 2. Destroy the old machine

Do this immediately after the clone is created. Destroying a machine does **not** delete its volume — the volume stays until you destroy it explicitly.

While the old machine still exists, the clone may fail health checks while LiteFS tries to reach the old primary. Destroy the old machine as soon as the clone is created.

```bash
fly machine destroy <machine-id> --app [APP_NAME] --force
```

### 3. Destroy the old volume

Only works after the old machine is gone.

```bash
fly volumes destroy <volume-id> --app [APP_NAME] --yes
```

Destroyed volumes may show as **pending destroy** in the Fly dashboard for a while before disappearing. `fly volumes list` should eventually show only the new volume attached to `<new-machine-id>`.

### 4. Start the new machine (if needed)

Once the old machine and volume are gone, the clone should become the LiteFS primary, run `npx prisma migrate deploy`, and start the app.

If health checks are still failing after a minute, restart the new machine:

```bash
fly machine restart <new-machine-id> --app [APP_NAME] --skip-health-checks
```

### 5. Verify migrations finished

```bash
fly logs --app [APP_NAME] --no-tail | tail -30
```

You want to see:

- `All migrations have been successfully applied`
- the app serving traffic normally

Also confirm the new machine is using the normal startup path:

```bash
fly machine status <new-machine-id> -a [APP_NAME]
```

The `Command` field should be empty, meaning the machine is using the Dockerfile default startup.

### 6. Reset Tigris storage

From your local machine, with production Tigris credentials available in `.env`:

```bash
npm run reset-storage
```

### 7. Create your account and restore admin access

Sign up again in the UI, then grant admin:

```bash
fly ssh console --app [APP_NAME] -C "cd /myapp && npx tsx scripts/make-admin.ts <username>"
```

Log out and back in so the session picks up the admin role.

### 8. Reconnect and re-sync

1. Reconnect YouTube OAuth
2. Re-sync playlists
3. Let the archive worker re-download audio

Tracks will show `--:--` for duration until the archive worker downloads them again.

## Common pitfalls

| Problem                                            | Why                                                               | What to do instead                                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `volume is currently bound to machine` on destroy  | Fly cannot destroy a volume while a machine still references it   | Clone first, destroy the old machine, then destroy the old volume                                    |
| `fly ssh console` fails while machine is stopped   | Fly requires a running VM for SSH                                 | Only SSH after the clone is running                                                                  |
| `prisma migrate reset` fails with `P3016`          | LiteFS holds the DB open while the app runs                       | Replace the volume via clone instead of using `migrate reset`                                        |
| Deleting DB files while app is running             | LiteFS may recreate or lock the file immediately                  | Replace the volume via clone instead of deleting files in place                                      |
| `prisma db seed` fails on production               | Seed imports test-only files not present in the image             | Skip seed entirely                                                                                   |
| `cannot become primary` / `no primary` after clone | Old machine still exists or LiteFS has not re-elected primary yet | Destroy the old machine and volume (steps 2–3), wait a minute, then restart the new machine (step 4) |
| Destroyed volume still visible in dashboard        | Fly shows volumes as **pending destroy** briefly after deletion   | Wait, or confirm with `fly volumes list` that only the new volume remains                            |
| Two machines after reset                           | Clone creates a second machine before you destroy the old one     | Destroy the old machine and its volume as soon as the clone is created                               |

## Example flow

```bash
fly machine list --app [APP_NAME]
fly volumes list --app [APP_NAME]

# In terminal 1: clone (may block on health checks)
fly machine clone <machine-id> --region cdg --app [APP_NAME]

# In terminal 2: as soon as clone is created
fly machine destroy <machine-id> --app [APP_NAME] --force
fly volumes destroy <volume-id> --app [APP_NAME] --yes

# If health checks are still failing after the old machine is gone:
fly machine restart <new-machine-id> --app [APP_NAME] --skip-health-checks

# wait for migrations in logs
fly logs --app [APP_NAME] --no-tail | tail -30

npm run reset-storage

# sign up again, then:
fly ssh console --app [APP_NAME] -C "cd /myapp && npx tsx scripts/make-admin.ts <username>"
```
