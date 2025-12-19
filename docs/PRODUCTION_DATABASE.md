# Production Database Management Guide

This guide covers how to manage your production SQLite database on Fly.io.

## Quick Reference

### Connect to Production Database

```bash
# SSH into your Fly.io app
fly ssh console --app [APP_NAME]

# Once inside, use the database CLI shortcut
database-cli

# Or directly with sqlite3
sqlite3 $DATABASE_URL
```

### Common Operations

#### Run Migrations

```bash
# Deploy migrations (safe for production)
fly ssh console --app [APP_NAME] -C "cd /myapp && npx prisma migrate deploy"
```

#### Backup Database

```bash
# Create a backup
fly ssh console --app [APP_NAME] -C "cp \$DATABASE_PATH /tmp/backup-$(date +%Y%m%d-%H%M%S).db"

# Download backup to local machine
fly sftp shell --app [APP_NAME]
# Then: get /tmp/backup-*.db ./backup.db
```

#### View Database Info

```bash
# Check database size
fly ssh console --app [APP_NAME] -C "ls -lh \$DATABASE_PATH"

# Check database integrity
fly ssh console --app [APP_NAME] -C "sqlite3 \$DATABASE_URL 'PRAGMA integrity_check;'"
```

#### Run Prisma Studio (Development Only)

⚠️ **Warning**: Prisma Studio is not recommended for production. Use SQL queries instead.

```bash
# For local development only
DATABASE_URL="file:./prisma/data.db" npx prisma studio
```

## Detailed Operations

### 1. Running Migrations

Migrations are automatically run during deployment via the `setup` script:
```bash
npm run setup  # Runs: build && prisma migrate deploy && prisma generate
```

To manually run migrations in production:
```bash
fly ssh console --app [APP_NAME] -C "cd /myapp && npx prisma migrate deploy"
```

### 2. Database Backup

#### Automated Backup Script

Create a backup script that runs periodically:

```bash
# Backup to Fly.io volume
fly ssh console --app [APP_NAME] -C "
  BACKUP_DIR=/litefs/data/backups
  mkdir -p \$BACKUP_DIR
  cp \$DATABASE_PATH \$BACKUP_DIR/backup-\$(date +%Y%m%d-%H%M%S).db
  # Keep only last 7 days of backups
  find \$BACKUP_DIR -name 'backup-*.db' -mtime +7 -delete
"
```

#### Download Backup Locally

```bash
# Method 1: Using fly sftp
fly sftp shell --app [APP_NAME]
# Then: get /litefs/data/sqlite.db ./backup-$(date +%Y%m%d).db

# Method 2: Using fly ssh with scp-like command
fly ssh console --app [APP_NAME] -C "cat \$DATABASE_PATH" > backup.db
```

### 3. Database Queries

#### Run SQL Queries

```bash
# Single query
fly ssh console --app [APP_NAME] -C "sqlite3 \$DATABASE_URL 'SELECT COUNT(*) FROM Track;'"

# Multiple queries (using heredoc)
fly ssh console --app [APP_NAME] << 'EOF'
sqlite3 $DATABASE_URL << 'SQL'
SELECT COUNT(*) as total_tracks FROM Track;
SELECT COUNT(*) as total_users FROM User;
SELECT COUNT(*) as total_playlists FROM Playlist;
SQL
EOF
```

#### Common Queries

```sql
-- Check database size
SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size();

-- List all tables
SELECT name FROM sqlite_master WHERE type='table';

-- Count records per table
SELECT 
  'Track' as table_name, COUNT(*) as count FROM Track
UNION ALL
SELECT 'User', COUNT(*) FROM User
UNION ALL
SELECT 'Playlist', COUNT(*) FROM Playlist
UNION ALL
SELECT 'ServicePlaylist', COUNT(*) FROM ServicePlaylist;

-- Check for orphaned records
SELECT COUNT(*) FROM Track t 
LEFT JOIN UserTrack ut ON t.id = ut.trackId 
WHERE ut.id IS NULL;

-- Find large tables
SELECT 
  name,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=m.name) as row_count
FROM sqlite_master m
WHERE type='table' AND name NOT LIKE 'sqlite_%';
```

### 4. Database Maintenance

#### Vacuum (Optimize Database)

```bash
fly ssh console --app [APP_NAME] -C "sqlite3 \$DATABASE_URL 'VACUUM;'"
```

#### Analyze (Update Statistics)

```bash
fly ssh console --app [APP_NAME] -C "sqlite3 \$DATABASE_URL 'ANALYZE;'"
```

#### Integrity Check

```bash
fly ssh console --app [APP_NAME] -C "sqlite3 \$DATABASE_URL 'PRAGMA integrity_check;'"
```

#### Checkpoint WAL (Write-Ahead Log)

```bash
fly ssh console --app [APP_NAME] -C "sqlite3 \$DATABASE_URL 'PRAGMA wal_checkpoint(TRUNCATE);'"
```

### 5. Restore from Backup

```bash
# Upload backup to Fly.io
fly sftp shell --app [APP_NAME]
# Then: put ./backup.db /tmp/restore.db

# Restore (⚠️ DANGEROUS - stops the app)
fly ssh console --app [APP_NAME] -C "
  # Stop the app first
  # Then restore
  cp /tmp/restore.db \$DATABASE_PATH
  # Restart the app
"
```

### 6. Database Monitoring

#### Check Database Health

```bash
# Check if database is accessible
fly ssh console --app [APP_NAME] -C "sqlite3 \$DATABASE_URL 'SELECT 1;'"

# Check database file permissions
fly ssh console --app [APP_NAME] -C "ls -la \$DATABASE_PATH"

# Check WAL file size (should be small)
fly ssh console --app [APP_NAME] -C "ls -lh \$DATABASE_PATH*"
```

#### Monitor Database Size

```bash
# Watch database size over time
fly ssh console --app [APP_NAME] -C "
  while true; do
    echo \$(date): \$(ls -lh \$DATABASE_PATH | awk '{print \$5}')
    sleep 60
  done
"
```

### 7. Emergency Operations

#### Reset Database (⚠️ DESTRUCTIVE)

**⚠️ WARNING**: This will DELETE ALL DATA in the database!

**Important**: With LiteFS, `prisma migrate reset` may fail with disk I/O errors due to active database connections. Use the manual procedure below instead.

**Recommended Procedure** (for LiteFS environments):

```bash
# 1. Stop the app to release database locks
fly machine stop [MACHINE_ID] --app [APP_NAME]

# 2. Wait a moment, then delete database files and recreate schema
fly ssh console --app [APP_NAME] -C "sh -c 'rm -f /litefs/data/sqlite.db /litefs/data/sqlite.db-wal /litefs/data/sqlite.db-shm && npx prisma migrate deploy'"

# 3. (Optional) Run seed if needed
fly ssh console --app [APP_NAME] -C "npx prisma db seed"
```

**Alternative** (if `prisma migrate reset` works):

```bash
# ⚠️ WARNING: This will delete all data!
fly ssh console --app [APP_NAME] -C "
  cd /myapp
  npx prisma migrate reset --force
  npx prisma db seed
"
```

**Note**: If you encounter `P3016` disk I/O errors, use the manual procedure above. The error occurs because LiteFS maintains active connections to the database file.

#### Manual Schema Changes

```bash
# Generate migration from schema changes
npx prisma migrate dev --name your_migration_name

# Apply to production
fly ssh console --app [APP_NAME] -C "cd /myapp && npx prisma migrate deploy"
```

## Environment Variables

Production database is configured via environment variables:

- `DATABASE_PATH`: `/litefs/data/sqlite.db` (set in Dockerfile)
- `DATABASE_URL`: `file:$DATABASE_PATH` (set in Dockerfile)
- `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK`: `1` (for WAL support)

## LiteFS Considerations

Since you're using LiteFS for SQLite replication:

1. **Primary Instance**: Only the primary instance can write to the database
2. **Read Replicas**: Other instances are read-only
3. **Failover**: LiteFS automatically handles failover

To check which instance is primary:
```bash
fly ssh console --app [APP_NAME] -C "litefs version"
```

## Troubleshooting

### Database Locked Errors

If you see "database is locked" errors:
1. Check if migrations are running
2. Verify LiteFS is working correctly
3. Check for long-running transactions

### Migration Failures

If migrations fail:
1. Check the migration status: `npx prisma migrate status`
2. Review migration files in `prisma/migrations/`
3. Manually fix if needed (be very careful!)

### Performance Issues

1. Run `VACUUM` to optimize the database
2. Run `ANALYZE` to update query statistics
3. Check for missing indexes
4. Review slow queries with `EXPLAIN QUERY PLAN`

## Best Practices

1. **Always backup before major operations**
2. **Test migrations on staging first**
3. **Monitor database size and growth**
4. **Run VACUUM periodically** (weekly/monthly)
5. **Keep backups for at least 30 days**
6. **Document any manual schema changes**
7. **Use transactions for multi-step operations**

## Scripts

See `scripts/` directory for helper scripts:
- `reset-storage.ts` - Reset Tigris storage (not database)
- `make-admin.ts` - Make a user an admin by username
- `manage-db.ts` - Database management operations

### Making a User Admin

**Local Development:**

```bash
npm run make-admin <username>
# Or: npx tsx scripts/make-admin.ts <username>
```

**Production (Fly.io) - Manual SQL Method (Recommended):**

Since scripts directory is not available in production builds, use direct SQL commands:

```bash
# 1. Find the user ID and admin role ID
fly ssh console --app [APP_NAME] -C "sqlite3 /litefs/data/sqlite.db \"SELECT id, username FROM User WHERE username = '<username>';\""
fly ssh console --app [APP_NAME] -C "sqlite3 /litefs/data/sqlite.db \"SELECT id, name FROM Role WHERE name = 'admin';\""

# 2. Check if user already has admin role
fly ssh console --app [APP_NAME] -C "sqlite3 /litefs/data/sqlite.db \"SELECT u.username, r.name FROM User u JOIN \\\"_RoleToUser\\\" ur ON u.id = ur.\\\"B\\\" JOIN Role r ON ur.\\\"A\\\" = r.id WHERE u.username = '<username>';\""

# 3. Add admin role (A = Role ID, B = User ID)
fly ssh console --app [APP_NAME] -C "sqlite3 /litefs/data/sqlite.db \"INSERT INTO \\\"_RoleToUser\\\" (\\\"A\\\", \\\"B\\\") VALUES ('<role_id>', '<user_id>');\""

# 4. Verify the role was added
fly ssh console --app [APP_NAME] -C "sqlite3 /litefs/data/sqlite.db \"SELECT u.username, r.name FROM User u JOIN \\\"_RoleToUser\\\" ur ON u.id = ur.\\\"B\\\" JOIN Role r ON ur.\\\"A\\\" = r.id WHERE u.username = '<username>';\""
```

**Example:**

```bash
# Find user and admin role IDs
fly ssh console --app music-library-5a00 -C "sqlite3 /litefs/data/sqlite.db \"SELECT id, username FROM User WHERE username = 'lieutner';\""
# Output: cmiopkumo0001lqnhn8b0yges|lieutner

fly ssh console --app music-library-5a00 -C "sqlite3 /litefs/data/sqlite.db \"SELECT id, name FROM Role WHERE name = 'admin';\""
# Output: clnf2zvlw000gpcour6dyyuh6|admin

# Add admin role (A = admin role ID, B = user ID)
fly ssh console --app music-library-5a00 -C "sqlite3 /litefs/data/sqlite.db \"INSERT INTO \\\"_RoleToUser\\\" (\\\"A\\\", \\\"B\\\") VALUES ('clnf2zvlw000gpcour6dyyuh6', 'cmiopkumo0001lqnhn8b0yges');\""

# Verify
fly ssh console --app music-library-5a00 -C "sqlite3 /litefs/data/sqlite.db \"SELECT u.username, r.name FROM User u JOIN \\\"_RoleToUser\\\" ur ON u.id = ur.\\\"B\\\" JOIN Role r ON ur.\\\"A\\\" = r.id WHERE u.username = 'lieutner';\""
```

**Important Notes:**
- The `_RoleToUser` join table uses: `A` = Role ID, `B` = User ID
- User must **log out and log back in** for the session to refresh with new roles
- The script method (`npx tsx scripts/make-admin.ts`) only works if scripts directory is deployed (not currently in Dockerfile)

**The script will (when available):**
1. Find the user by username
2. Check if they're already an admin
3. Add the admin role (without removing existing roles)
4. Verify the change

**Note**: `tsx` has been moved to `dependencies` so it's available in production after deployment.

### Resetting Database

⚠️ **WARNING**: This will DELETE ALL DATA!

**Local Development:**

```bash
npm run db:reset:script -- --force
npm run db:reset:script -- --force --seed  # Also run seed
```

**Production (Fly.io with LiteFS):**

The reset script may not work in production due to LiteFS disk I/O errors. Use the manual procedure:

```bash
# 1. Stop the app to release database locks
fly machine stop [MACHINE_ID] --app [APP_NAME]

# 2. Delete database files and recreate schema
fly ssh console --app [APP_NAME] -C "sh -c 'rm -f /litefs/data/sqlite.db /litefs/data/sqlite.db-wal /litefs/data/sqlite.db-shm && npx prisma migrate deploy'"

# 3. (Optional) Run seed if needed
fly ssh console --app [APP_NAME] -C "npx prisma db seed"
```

**Why manual deletion?** LiteFS maintains active connections to the database file. `prisma migrate reset` may fail with `P3016` disk I/O errors because it cannot clean up the database while connections are active. Stopping the app releases these locks, allowing safe deletion and recreation.

**Safety checks:**
- Always stop the app before resetting in production
- Verify migration status after reset: `npx prisma migrate status`
- Consider creating a backup before resetting (see Backup section above)

## References

- [Prisma Migrate Guide](https://www.prisma.io/docs/guides/migrate)
- [SQLite Documentation](https://www.sqlite.org/docs.html)
- [LiteFS Documentation](https://fly.io/docs/litefs/)
- [Fly.io SQLite Guide](https://fly.io/docs/postgres/connecting-to-postgres/)

