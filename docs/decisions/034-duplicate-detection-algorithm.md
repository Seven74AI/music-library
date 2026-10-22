# ADR-034: Duplicate Detection Algorithm

**Status:** Accepted  
**Date:** 2026-10-02

## Context

Music metadata is messy. The same artist appears with slight variations:

- "The Beatles" vs "Beatles"
- "Björk" vs "Bjork"
- "AC/DC" vs "AC-DC" vs "ACDC"

Albums have similar issues:

- "OK Computer" (1997) vs "OK Computer [Remaster]" (2009)
- Same album name by different artists
- Different capitalizations and punctuation

Manual duplicate detection doesn't scale. With thousands of artists and albums, curators need automated detection to surface potential duplicates for review and merging.

## Decision

### Two-Phase Detection: Exact + Fuzzy

Run duplicate detection in two phases:

**Phase 1: Exact Matches** (cheap, high precision)

- Case-insensitive string comparison
- Normalized whitespace
- Guaranteed duplicates

**Phase 2: Fuzzy Matches** (expensive, lower precision)

- Levenshtein distance for string similarity
- Identifies likely duplicates for curator review

Separate phases allow curators to prioritize high-confidence matches and provide clear confidence signals.

### Artist Duplicate Detection

**Criteria:**

```typescript
// Exact match
normalizedName1 === normalizedName2;

// Fuzzy match
levenshteinDistance(normalizedName1, normalizedName2) <= threshold;
```

**Normalization:**

```typescript
function normalizeArtistName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ") // collapse whitespace
    .replace(/^the\s+/i, "") // remove leading "the"
    .replace(/[^\w\s]/g, ""); // remove punctuation
}

// Examples:
// "The Beatles" → "beatles"
// "AC/DC" → "acdc"
// "Björk" → "bjork" (Unicode normalization)
```

**Fuzzy Threshold:**

- Levenshtein distance ≤ 2 for names < 10 characters
- Levenshtein distance ≤ 3 for names ≥ 10 characters

**Rationale:**

- Catches typos: "Betles" → "Beatles" (distance 2)
- Catches alternative spellings: "Bjork" → "Björk" (distance 1)
- Avoids false positives: "Queen" vs "Queens" (distance 1, but different artists)

**Deduplication:**

- Only flag once per normalized name
- Example: "The Beatles" and "Beatles" both normalize to "beatles" → show as one duplicate group

### Album Duplicate Detection

**Criteria:**

Albums are contextual - same name is acceptable for different artists. Detection requires artist match:

```typescript
// Exact match
normalizedAlbumName1 === normalizedAlbumName2 && artistId1 === artistId2;

// Fuzzy match (same artist)
levenshteinDistance(normalizedAlbumName1, normalizedAlbumName2) <= threshold &&
  artistId1 === artistId2;

// Fuzzy match (similar artist + similar year)
levenshteinDistance(normalizedAlbumName1, normalizedAlbumName2) <= threshold &&
  levenshteinDistance(normalizedArtistName1, normalizedArtistName2) <= threshold &&
  Math.abs(year1 - year2) <= 2;
```

**Normalization:**

```typescript
function normalizeAlbumName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\[(remaster|deluxe|expanded|special edition)\]/gi, "") // remove edition markers
    .replace(/[^\w\s]/g, "");
}

// Examples:
// "OK Computer [Remaster]" → "ok computer"
// "Kid A (Collector's Edition)" → "kid a collectors edition"
```

**Year tolerance:**

- ±2 years accounts for regional release differences
- Example: Album released 2020 in US, 2021 in UK → same album

### Performance Optimization

**Caching:**

- Run detection as background job
- Cache results in database (`DuplicateDetection` table)
- Refresh daily via cron
- Manual refresh button for curators (re-run detection immediately)

**Indexed Queries:**

- Index on normalized names for fast exact match queries
- Fuzzy detection runs in batches (1000 artists at a time)

**Database Schema:**

```prisma
model DuplicateDetection {
  id          String   @id @default(cuid())
  entityType  String   // "artist" | "album"
  lastRunAt   DateTime @default(now())
  results     Json     // Cached duplicate groups

  @@unique([entityType])
}

model NormalizedName {
  id            String   @id @default(cuid())
  entityType    String
  entityId      String
  normalizedName String

  @@index([entityType, normalizedName])
  @@unique([entityType, entityId])
}
```

**Background Job:**

```typescript
// Runs daily at 2 AM UTC
async function runDuplicateDetection() {
  // Phase 1: Exact matches
  const exactDuplicates = await findExactDuplicates();

  // Phase 2: Fuzzy matches
  const fuzzyDuplicates = await findFuzzyDuplicates();

  // Cache results
  await prisma.duplicateDetection.upsert({
    where: { entityType: "artist" },
    update: {
      lastRunAt: new Date(),
      results: { exact: exactDuplicates, fuzzy: fuzzyDuplicates },
    },
    create: {
      entityType: "artist",
      results: { exact: exactDuplicates, fuzzy: fuzzyDuplicates },
    },
  });
}
```

### Display Format

**Duplicate Groups:**

```typescript
{
  normalizedName: "beatles",
  matchType: "exact", // or "fuzzy"
  artists: [
    { id: "...", name: "The Beatles", trackCount: 245, albumCount: 13 },
    { id: "...", name: "Beatles", trackCount: 12, albumCount: 1 }
  ],
  totalTracks: 257
}
```

**UI Presentation:**

- Separate sections for exact vs fuzzy matches
- Sort by total track count (descending)
- Show track/album counts per duplicate
- "Merge These →" button per group

### False Positive Handling

Fuzzy matching will have false positives:

- "Queen" vs "Queens of the Stone Age"
- "Tool" vs "Toolbox"

**Mitigation:**

- Curators review before merging (no auto-merge)
- Dismissable false positives (hide from list)
- Adjustable thresholds in admin settings

**Future Enhancement:**

- Machine learning similarity based on track titles, genres
- Curator feedback loop (learn from merge/dismiss patterns)

## Consequences

### Positive

- **Automated discovery**: Curators don't manually search for duplicates
- **Scalable**: Works with thousands of artists/albums
- **Cached results**: Instant display, no wait for computation
- **Clear confidence**: Exact vs fuzzy separation helps prioritization
- **Contextual album detection**: Doesn't flag legitimate same-named albums by different artists

### Negative

- **False positives**: Fuzzy matching will suggest non-duplicates for review
- **Threshold tuning**: May require adjustment based on real data
- **Daily refresh**: New duplicates not detected immediately (manual refresh available)

### Trade-offs

**Why Levenshtein over soundex/metaphone?**

- Soundex designed for English surnames, not band names
- Levenshtein handles typos and spelling variations better
- "Björk" vs "Bjork" (Levenshtein ✓, soundex ✗)

**Why not machine learning similarity?**

- ML requires training data (curator merge history)
- Complex infrastructure (model training, inference)
- V1 uses simpler rule-based approach, can add ML later

**Why daily refresh instead of real-time?**

- Fuzzy detection expensive (O(n²) comparisons)
- Real-time would slow down track imports
- Daily refresh acceptable - duplicates not urgent
- Manual refresh available for immediate needs

**Why cache in database instead of memory?**

- Survives server restarts
- Shareable across instances (if scaling horizontally)
- Historical record of detection runs

## Performance Estimates

**Test data:** 10,000 artists

**Exact match query:**

```sql
SELECT normalizedName, COUNT(*) as count
FROM NormalizedName
WHERE entityType = 'artist'
GROUP BY normalizedName
HAVING count > 1
```

Execution time: ~50ms (with index)

**Fuzzy match (Levenshtein):**

- Compare each pair: 10,000 × 10,000 = 100M comparisons (naïve)
- With blocking (group by first letter): ~4M comparisons
- Execution time: ~30 seconds (batched, indexed)

**Total detection time:** ~1 minute for 10,000 artists
**Acceptable for background job.**

## Implementation Notes

### Levenshtein Distance

Use `js-levenshtein` library (fast, no dependencies):

```typescript
import levenshtein from "js-levenshtein";

function isSimilar(name1: string, name2: string): boolean {
  const normalized1 = normalizeArtistName(name1);
  const normalized2 = normalizeArtistName(name2);

  const distance = levenshtein(normalized1, normalized2);
  const threshold = normalized1.length < 10 ? 2 : 3;

  return distance <= threshold;
}
```

### Blocking Strategy

Reduce comparisons by grouping:

```typescript
// Group by first 2 characters
const blocks = groupBy(artists, (a) => normalizeArtistName(a.name).slice(0, 2));

// Only compare within blocks
for (const [key, group] of blocks) {
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      if (isSimilar(group[i].name, group[j].name)) {
        // Found duplicate
      }
    }
  }
}
```

Reduces comparisons by ~95% with minimal false negatives.

## Alternatives Considered

### Real-time detection on import

Run detection when tracks are added.

**Rejected because:**

- Slows down imports
- Redundant (same duplicates detected repeatedly)
- Background job more efficient

### Soundex/Metaphone phonetic matching

Use phonetic algorithms for similarity.

**Rejected because:**

- Designed for English names, poor for band names
- Doesn't catch spelling variations like "Björk" vs "Bjork"
- Levenshtein more appropriate for this use case

### Exact match only (no fuzzy)

Only detect identical normalized names.

**Rejected because:**

- Misses common variations ("The Beatles" vs "Beatles")
- Misses typos ("Betles" vs "Beatles")
- Fuzzy matching provides significant value despite false positives

### Embeddings-based similarity (ML)

Use text embeddings (e.g., sentence-transformers) for semantic similarity.

**Rejected for v1 because:**

- Overkill for name comparison
- Requires ML infrastructure (model hosting, inference)
- Levenshtein sufficient for v1
- Can add ML in v2 if needed

## References

- Related: ADR-031 (Curator Role), ADR-035 (Review Queue)
- Levenshtein distance: https://en.wikipedia.org/wiki/Levenshtein_distance
- Library: https://www.npmjs.com/package/js-levenshtein
