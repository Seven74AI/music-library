# Resetting the Production DB During Development

Use this guide when you intentionally want to wipe the **production** Fly.io environment and rebuild it from migrations for another round of development testing.

No backup is needed if the wipe is deliberate.

For normal production database operations such as backups, one-off queries, or maintenance, see `docs/PRODUCTION_DATABASE.md`.

## Scope

This procedure resets two independent things:

| Target | Effect |
|--------|--------|
| SQLite database on Fly volume | Deletes all users, tracks, playlists, archive jobs, OAuth connections, etc. Schema is recreated from committed Prisma migrations. |
| Tigris storage | Deletes all archived audio files and cover images. |

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
fly machine list --app music-library-5a00
fly volumes list --app music-library-5a00
```

From app config and current Fly state:

- app: `music-library-5a00`
- volume name: `data`
- region: `cdg`
- volume size: `1GB`

In the commands below, replace only:

- `<machine-id>` with the current Fly machine ID
- `<new-machine-id>` with the ID returned by `fly machine clone`
- `<volume-id>` with the old `data` volume ID (the one attached to `<machine-id>`)

## Reset procedure

### 1. Clone the machine

Creates a new machine with a fresh empty `data` volume.

```bash
fly machine clone <machine-id> --region cdg --app music-library-5a00
```

Add `--detach` to return immediately instead of waiting for health checks.

Note the new machine ID from the output (e.g. `Machine d896675a335678 has been created`).

The clone command may block on health checks while the old machine still exists. That is expected — continue with step 2 in another terminal as soon as the clone is created.

### 2. Destroy the old machine

Do this immediately after the clone is created. Destroying a machine does **not** delete its volume — the volume stays until you destroy it explicitly.

LiteFS uses a Consul lease keyed by `other/litefs.yml` → `lease.consul.key`. While the old machine still exists (even stopped), the clone may fail health checks with `cannot become primary, local node has no cluster ID`.

```bash
fly machine destroy <machine-id> --app music-library-5a00 --force
```

### 3. Destroy the old volume

Only works after the old machine is gone.

```bash
fly volumes destroy <volume-id> --app music-library-5a00 --yes
```

Destroyed volumes may show as **pending destroy** in the Fly dashboard for a while before disappearing. `fly volumes list` should eventually show only the new volume attached to `<new-machine-id>`.

### 4. Clear the stale LiteFS Consul cluster ID (if needed)

If the clone is still stuck in a `cannot become primary` / `no primary` loop after steps 2–3, Consul still holds the old cluster ID from the previous volume ([Fly LiteFS disaster recovery](https://fly.io/docs/litefs/disaster-recovery/#resolve-consul-key-error)).

**Option A — delete the stale Consul key (no redeploy)**

The key path is `$PREFIX/$LITEFS_CONSUL_KEY/clusterid`, where `LITEFS_CONSUL_KEY` comes from `other/litefs.yml` → `lease.consul.key` (currently `epic-stack-litefs_20250222/music-library-5a00`).

```bash
fly ssh console --app music-library-5a00 -C "node -e \"
const url = new URL(process.env.FLY_CONSUL_URL);
const token = url.password;
const host = url.hostname;
const prefix = url.pathname.replace(/^\\//, '').replace(/\\/$/, '');
const litefsKey = 'epic-stack-litefs_20250222/music-library-5a00';
fetch('https://' + host + '/v1/kv/' + prefix + '/' + litefsKey + '/clusterid?token=' + token, { method: 'DELETE' })
  .then(r => r.text())
  .then(console.log);
\""
```

Fly's official docs use the `consul kv delete` CLI for this step if `consul` is installed in the image. Our production image does not include it, so the Node one-liner above works via the Consul HTTP API.

**Option B — bump the Consul key and redeploy (Fly's easy option)**

Change `lease.consul.key` in `other/litefs.yml` to a new unused value (e.g. add `-v2`), then redeploy:

```bash
fly deploy --ha=false --app music-library-5a00
```

The old Consul key remains but LiteFS ignores it.

**Then restart the new machine:**

```bash
fly machine restart <new-machine-id> --app music-library-5a00 --skip-health-checks
```

On boot, LiteFS should acquire the primary lease, run `npx prisma migrate deploy`, and start the app.

### 5. Verify migrations finished

```bash
fly logs --app music-library-5a00 --no-tail | tail -30
```

You want to see:

- `All migrations have been successfully applied`
- the app serving traffic normally

Also confirm the new machine is using the normal startup path:

```bash
fly machine status <new-machine-id> -a music-library-5a00
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
fly ssh console --app music-library-5a00 -C "cd /myapp && npx tsx scripts/make-admin.ts <username>"
```

Log out and back in so the session picks up the admin role.

### 8. Reconnect and re-sync

1. Reconnect YouTube OAuth
2. Re-sync playlists
3. Let the archive worker re-download audio

Tracks will show `--:--` for duration until the archive worker downloads them again.

## Common pitfalls

| Problem | Why | What to do instead |
|---------|-----|--------------------|
| `volume is currently bound to machine` on destroy | Fly cannot destroy a volume while a machine still references it | Clone first, destroy the old machine, then destroy the old volume |
| `fly ssh console` fails while machine is stopped | Fly requires a running VM for SSH | Only SSH after the clone is running |
| `prisma migrate reset` fails with `P3016` | LiteFS holds the DB open while the app runs | Replace the volume via clone instead of using `migrate reset` |
| Deleting DB files while app is running | LiteFS may recreate or lock the file immediately | Replace the volume via clone instead of deleting files in place |
| `prisma db seed` fails on production | Seed imports test-only files not present in the image | Skip seed entirely |
| `cannot become primary, local node has no cluster ID` | Fresh volume has a new cluster ID but Consul still holds the old one | Clear the Consul `clusterid` key (step 4A) or bump `lease.consul.key` and redeploy (step 4B), then restart |
| Destroyed volume still visible in dashboard | Fly shows volumes as **pending destroy** briefly after deletion | Wait, or confirm with `fly volumes list` that only the new volume remains |
| Two machines after reset | Clone creates a second machine before you destroy the old one | Destroy the old machine and its volume as soon as the clone is created |

## Example flow

```bash
fly machine list --app music-library-5a00
fly volumes list --app music-library-5a00

# In terminal 1: clone (may block on health checks)
fly machine clone <machine-id> --region cdg --app music-library-5a00

# In terminal 2: as soon as clone is created
fly machine destroy <machine-id> --app music-library-5a00 --force
fly volumes destroy <volume-id> --app music-library-5a00 --yes

# If clone is stuck on LiteFS primary election, clear Consul cluster ID (step 4) then:
fly machine restart <new-machine-id> --app music-library-5a00 --skip-health-checks

# wait for migrations in logs
fly logs --app music-library-5a00 --no-tail | tail -30

npm run reset-storage

# sign up again, then:
fly ssh console --app music-library-5a00 -C "cd /myapp && npx tsx scripts/make-admin.ts <username>"
```
