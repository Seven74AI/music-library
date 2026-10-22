# Audio File Deduplication & Similarity Detection

## Overview

This implementation provides two levels of duplicate detection:

1. **Exact Duplicate Detection (SHA-256):** Detects identical audio files byte-for-byte
2. **Perceptual Similarity Detection (Chromaprint):** Detects similar audio (re-encodes, different formats, remasters)

Both features work together to prevent duplicate storage and warn users about similar content.

## What Was Implemented

### 1. Schema Changes (`prisma/schema.prisma`)

- Added `contentHash` field to `TrackAudioFile` model (SHA-256 hash of audio content)
- Added `audioFingerprint` field to `TrackAudioFile` model (Chromaprint fingerprint)
- Added indices on both `contentHash` and `audioFingerprint` for efficient lookups
- Migration files created:
  - `prisma/migrations/20260924102309_add_content_hash_to_track_audio_file/migration.sql`
  - `prisma/migrations/20260924150400_add_audio_fingerprint_to_track_audio_file/migration.sql`

### 2. Audio Hash & Fingerprint Utilities (`app/utils/audio-file-management.server.ts`)

**Exact Duplicate Detection:**

- `calculateAudioHash()` function using SHA-256 (same pattern as cover images)

**Perceptual Similarity Detection:**

- `generateAudioFingerprint()` function using Chromaprint (via `fpcalc` package)
- `calculateFingerprintSimilarity()` function to compare fingerprints (0-1 scale)
- Similarity threshold: 0.90 (90% match)

Comprehensive test coverage in `audio-file-management.server.test.ts`

### 3. Upload Logic Updates

#### `persistTrackAudio()` function

**Location:** `app/features/track-audio-ingest/persist-track-audio.server.ts`

**New behavior:**

1. Calculate SHA-256 hash of audio buffer
2. Generate Chromaprint audio fingerprint
3. Check if audio with same hash already exists (exact duplicate)
4. If no exact duplicate, check for similar fingerprints (>= 90% similarity)
5. If exact duplicate found:
   - Skip S3 upload (reuse existing object)
   - Create new `TrackAudioFile` record with existing `objectKey`
   - Return duplicate info in result
6. If similar audio found (but not exact):
   - Upload to S3 as normal (different audio content)
   - Store hash and fingerprint with new record
   - Return similarity info in result (track, similarity percentage)
7. If unique:
   - Upload to S3 as before
   - Store hash and fingerprint with new record

**Storage savings:** Exact duplicate audio files don't create new S3 objects, saving storage costs.

**User benefits:** Users are warned about similar audio (re-encodes, different formats) even when not byte-identical.

#### Upload endpoints updated:

- `/api/upload-audio-batch` - Batch upload (logs duplicate warnings)
- `/api/upload-audio` - Single file upload (logs duplicate warnings)

### 4. Database Seed Updated (`prisma/seed.ts`)

- Now calculates and stores `contentHash` for seeded audio files

### 5. Test Coverage

**New tests:**

- Hash calculation tests (5 test cases)
- Duplicate detection tests (6 test cases)
- S3 object reuse verification
- Progress callback handling for duplicates

## How It Works

### Upload Flow (Before)

```
User uploads song.mp3
  ↓
Create Track record (new ID)
  ↓
Upload to S3: audio/tracks/local/{trackId}.mp3
  ↓
Create TrackAudioFile record
  ↓
Done - 100MB file uploaded
```

### Upload Flow (After - Duplicate Detected)

```
User uploads song.mp3 (again)
  ↓
Calculate SHA-256 hash
  ↓
Check database for existing hash
  ↓
FOUND! Existing track: "Song Title" by Artist
  ↓
Create new Track record (new ID)
  ↓
SKIP S3 upload (reuse existing objectKey)
  ↓
Create TrackAudioFile pointing to existing S3 object
  ↓
Log warning: "Duplicate: song.mp3 has same audio as..."
  ↓
Done - 0MB uploaded, storage saved! ✅
```

## What You Need To Do

### 1. Apply the Database Migration

The database schema changes are ready but NOT yet applied. You need to run:

```bash
npx prisma migrate deploy
```

**OR** for development (resets the database):

```bash
npx prisma migrate reset --force
```

⚠️ **Warning:** `migrate reset` will **delete all data** in your database. Only use this in development environments.

### 2. Backfill Existing Audio Files

After applying the migration, generate hashes and fingerprints for all existing audio files:

```bash
# Preview what will be changed (safe)
npx tsx prisma/backfill-audio-hashes.ts --dry-run

# Actually update the database
npx tsx prisma/backfill-audio-hashes.ts
```

This script:

- Finds all `TrackAudioFile` records with `contentHash: null` or `audioFingerprint: null`
- Downloads files from S3 or reads from local storage
- Calculates SHA-256 hash for each file
- Generates Chromaprint fingerprint for each file
- Updates database records
- Reports any duplicates discovered

**Expected output:**

```
🔍 Finding TrackAudioFile records without contentHash...

Found 25 audio files to hash

[1/25] Processing: song1.mp3
  🔨 Needs hash
  🎵 Needs fingerprint
  🌐 Downloading from S3: audio/tracks/local/abc123.mp3
  ✓ Downloaded from S3 (5.23 MB)
  📊 Hash: 4a5d7c8b9e2f1a3b...
  🎵 Fingerprint: AQADtNE123...
  ✅ Updated in database

...

═══════════════════════════════════════════════════
📊 Summary:
   ✅ Successfully hashed: 25
   ⏭️  Skipped: 0
   ❌ Errors: 0
   📝 Total processed: 25
═══════════════════════════════════════════════════

🔍 Checking for newly discovered duplicates...

⚠️  Found 2 duplicate audio hashes:

  Hash: 4a5d7c8b9e2f1a3b... (3 files)
    1. "Song Title" by Artist (song1.mp3)
    2. "Song Title (Copy)" by Artist (song1-copy.mp3)
    3. "Song Title (Another)" by Artist (song1-another.mp3)

💡 Consider consolidating these duplicates to save storage.
   See docs/audio-deduplication.md for cleanup strategies.
```

### 3. Run the Tests

After applying the migration:

```bash
npm test -- app/utils/audio-file-management.server.test.ts
npm test -- app/features/track-audio-ingest/persist-track-audio.server.test.ts
```

All tests should pass ✅

### 3. Test Manually

1. Start the dev server: `npm run dev`
2. Login as admin: `kody` / `kodylovesyou`
3. Go to: http://localhost:3000/music/services/local/upload
4. Upload an audio file
5. Upload the **same file again**
6. Check server logs for duplicate warning:
   ```
   ⚠️  Duplicate: "song.mp3" has same audio as "Song Title" by Artist Name
   ```

### 4. Verify in Database

```sql
-- Check that contentHash is being stored
SELECT id, fileName, contentHash
FROM TrackAudioFile
LIMIT 5;

-- Find duplicate audio files (same content, different tracks)
SELECT contentHash, COUNT(*) as count
FROM TrackAudioFile
WHERE contentHash IS NOT NULL
GROUP BY contentHash
HAVING COUNT(*) > 1;
```

## Chromaprint Audio Fingerprinting

### What is Chromaprint?

Chromaprint is an open-source audio fingerprinting library (MIT license) that generates compact fingerprints representing the perceptual characteristics of audio. Unlike SHA-256 hashes that require byte-for-byte matches, Chromaprint fingerprints can detect:

- **Same song, different bitrate** (320kbps MP3 vs 128kbps MP3)
- **Same song, different format** (MP3 vs FLAC vs WAV)
- **Remasters** (same song, slightly different mastering)
- **Re-encodes** (audio transcoded between formats)

### How It Works

1. **Fingerprint Generation:** The `fpcalc` binary analyzes the audio waveform and generates a base64-encoded fingerprint string (e.g., `AQADtNE123...`)

2. **Similarity Comparison:** When a new audio file is uploaded, its fingerprint is compared against all existing fingerprints in the database using a character-based similarity algorithm

3. **Threshold Detection:** If similarity >= 90%, the tracks are considered perceptually similar

4. **User Warning:** The system warns about similar audio but still allows the upload (unlike exact duplicates which reuse storage)

### Why 90% Threshold?

- **Too high (>95%):** Misses legitimate re-encodes and format conversions
- **Too low (<85%):** False positives (different songs flagged as similar)
- **90%:** Balanced threshold that catches most re-encodes while minimizing false positives

### Example Use Cases

**Re-encoded Audio:**

```
User uploads: song.mp3 (320kbps, 10MB)
Later uploads: song.flac (lossless, 40MB)
→ 94% similar → Warning: "Similar to existing track"
→ Both stored (different quality/format preferences)
```

**Different Bitrates:**

```
User uploads: song_high.mp3 (320kbps)
Later uploads: song_low.mp3 (128kbps, same song)
→ 92% similar → Warning shown
```

**Remasters:**

```
User uploads: song_original.mp3 (1990 master)
Later uploads: song_remastered.mp3 (2020 remaster)
→ 91% similar → Warning shown
→ User can keep both versions
```

### Performance Considerations

- Fingerprint generation adds ~500ms to upload time (one-time cost)
- Similarity comparison is fast (O(n) where n = existing fingerprints)
- For large libraries (>10,000 tracks), consider optimizing comparison logic
- Failed fingerprint generation (e.g., corrupted audio) doesn't block upload

## Monitoring fingerprint / decode failures

After backfill (`prisma/backfill-audio-hashes.ts`) or ingest, each `TrackAudioFile` falls into one of:

| Signal             | `contentHash` | `audioFingerprint` | Meaning                                                                                                             |
| ------------------ | ------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Healthy            | set           | set                | Hash + Chromaprint OK                                                                                               |
| Fingerprint failed | set           | `null`             | SHA-256 OK; `fpcalc` failed (often corrupt/truncated MP3, e.g. YouTube downloads with `Error decoding audio frame`) |
| Unprocessed        | `null`        | `null`             | Not yet hashed / fingerprinted                                                                                      |

There is no separate error column — ops monitor the hash-set / fingerprint-null combination.

**Admin UI:** `/music/admin/fingerprint-failures` (admin role). Summary stats plus a paginated, filterable list (format, service, file-size bucket). API: `/api/admin/fingerprint-failures`. Related: `/music/admin/duplicates`.

## Architecture Decisions

### Important: Existing Uploads

**⚠️ Critical:** Audio files uploaded BEFORE this feature won't have a `contentHash` or `audioFingerprint`. This means:

1. They won't be detected as exact duplicates
2. They won't be detected as similar audio
3. Re-uploading the same file will create new S3 objects
4. You'll waste storage on duplicates

**Solution:** Run the backfill script (step 2 above) to generate hashes and fingerprints for all existing files.

**Example Problem:**

```
Day 1 (before deduplication feature):
- User uploads "song.mp3" → contentHash: null

Day 2 (after deploying this feature):
- User uploads same "song.mp3" again
- System calculates hash: "abc123..."
- Looks for existing: SELECT * WHERE contentHash = "abc123..."
- Finds nothing! (old record has null)
- Creates new S3 object → DUPLICATE! ❌
```

**After Backfill:**

```
Run backfill script:
- Updates old record: contentHash: "abc123..."

User uploads same "song.mp3" again:
- System calculates hash: "abc123..."
- Finds existing match! ✅
- Reuses S3 object → No duplicate!
```

### Why Allow Multiple Tracks with Same Audio?

We considered three approaches:

1. **Block duplicate uploads entirely** ❌
   - Too restrictive (legitimate use cases exist)
   - User might want different metadata for same audio

2. **Share TrackAudioFile records between tracks** ❌
   - Requires major schema changes
   - Breaks 1:1 Track→TrackAudioFile relationship

3. **Allow duplicates but optimize storage** ✅ (Implemented)
   - Multiple tracks can have same audio
   - Only one S3 object stored
   - User gets warned about duplicates
   - Best balance of flexibility and efficiency

### Why SHA-256 + Chromaprint?

**SHA-256 (Exact Duplicates):**

- Same hashing algorithm used for cover images
- Industry standard for content identification
- Fast enough for audio files (100MB files hash in <1s)
- Cryptographically secure (prevents collisions)
- Enables storage optimization (reuse S3 objects)

**Chromaprint (Similar Audio):**

- Detects perceptual similarity (not just byte-for-byte matches)
- Open source and MIT licensed
- Used by AcoustID and MusicBrainz
- Compact fingerprint size (~200-500 characters)
- Robust to format changes and re-encoding

**Why Both?**

- SHA-256: Fast, precise, enables storage savings
- Chromaprint: Catches re-encodes and format conversions SHA-256 misses
- Complementary approaches for comprehensive duplicate detection

### Why Store Both in Database?

**contentHash:**

- Fast exact duplicate lookups via indexed column
- No need to download/hash files for comparison
- Enables storage deduplication

**audioFingerprint:**

- Fast perceptual similarity detection
- No need to re-analyze audio files
- Enables future features:
  - Admin dashboard showing duplicate and similar audio stats
  - Bulk cleanup of duplicate storage
  - API to find "similar" tracks by content
  - Automatic playlist generation (find similar songs)
  - Music recommendation engine

## Storage Savings Examples

### Exact Duplicates (SHA-256)

**Before (no deduplication):**

- User uploads same 10MB song 5 times
- Storage used: 50MB
- S3 objects: 5

**After (with deduplication):**

- User uploads same 10MB song 5 times
- Storage used: 10MB
- S3 objects: 1
- **Savings: 40MB (80%)**

### Re-encoded Audio (Chromaprint)

**Scenario:**

- User uploads: song.mp3 (320kbps, 10MB)
- User uploads: song.flac (lossless, 40MB)
- 94% similar by fingerprint

**Result:**

- Both files stored (different formats, user choice)
- User warned: "Similar to existing track"
- No automatic deduplication (different audio data)
- User can decide to keep or delete

**Benefit:** Prevents accidental duplicate uploads while respecting user choice for different formats/qualities

## Future Enhancements

Possible next steps:

1. **UI Improvements**
   - Show duplicate warning in upload UI (not just logs)
   - Link to existing track when duplicate detected
   - "Upload anyway" option with explicit choice

2. **Admin Dashboard**
   - Page showing all duplicate audio files (`/music/admin/duplicates`)
   - Fingerprint / decode failure monitor (`/music/admin/fingerprint-failures`)
   - One-click to merge/delete duplicates
   - Storage savings report

3. **Migration Script**
   - Hash all existing audio files
   - Detect and consolidate duplicates
   - Update to single S3 objects

4. **Enhanced Similarity Features**
   - Music recommendation engine based on fingerprint similarity
   - "Find similar tracks" feature
   - Auto-playlist generation (similar sounding songs)
   - Integration with MusicBrainz AcoustID for track identification

## Files Changed

```
Modified:
- prisma/schema.prisma (added contentHash and audioFingerprint)
- app/features/track-audio-ingest/persist-track-audio.server.ts (fingerprint generation and similarity detection)
- app/routes/api+/upload-audio-batch.tsx
- app/routes/api+/upload-audio.tsx
- app/utils/storage.server.ts (added downloadFile function)
- prisma/seed.ts
- package.json (added fpcalc dependency)

Added:
- app/utils/audio-file-management.server.ts (hash + fingerprint utilities)
- app/utils/audio-file-management.server.test.ts (comprehensive tests)
- prisma/migrations/20260924102309_add_content_hash_to_track_audio_file/migration.sql
- prisma/migrations/20260924150400_add_audio_fingerprint_to_track_audio_file/migration.sql
- prisma/backfill-audio-hashes.ts (for existing uploads, now includes fingerprints)
- docs/audio-deduplication.md (this file)

Updated Tests:
- app/features/track-audio-ingest/persist-track-audio.server.test.ts (added 13 new fingerprint tests)
```

## Questions?

If you encounter issues or have questions about this implementation, please review:

1. The test files for usage examples
2. The code comments in `persist-track-audio.server.ts`
3. Similar pattern in `cover-management.server.ts` (for cover images)
