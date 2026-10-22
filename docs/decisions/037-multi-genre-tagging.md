# ADR-037: Multi-Genre Tagging System

**Status:** Accepted  
**Date:** 2026-10-02

## Context

Music genres are not mutually exclusive. Many tracks span multiple genres:

- "Bohemian Rhapsody" by Queen: Rock, Progressive Rock, Opera
- "Smells Like Teen Spirit" by Nirvana: Grunge, Alternative Rock, Hard Rock
- "Hotline Bling" by Drake: R&B, Pop, Hip Hop

Current single-genre model forces curators to choose one genre, losing information:

- Choosing "Rock" loses "Progressive Rock" nuance
- Choosing "Progressive Rock" may miss users searching "Rock"

Search and filtering suffer:

- User searches "Rock" → misses tracks tagged only "Progressive Rock"
- User filters by "Pop" → misses "Hotline Bling" if tagged "R&B"

Multi-genre tagging improves accuracy, discoverability, and flexibility.

## Decision

### Many-to-Many Genre Relationship

Replace single `genre` string field with many-to-many relationship between tracks and genres.

**Database Schema:**

```prisma
model Track {
  // ... existing fields
  genres  Genre[]  @relation("TrackGenres")
}

model Genre {
  id          String   @id @default(cuid())
  name        String   @unique
  description String?
  createdAt   DateTime @default(now())

  tracks      Track[]  @relation("TrackGenres")
}
```

**Key Changes:**

- Remove `track.genre` string field
- Add `Genre` model
- Add many-to-many relation via join table

**Migration:**

```sql
-- Create Genre table
CREATE TABLE Genre (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  createdAt INTEGER NOT NULL
);

-- Create join table
CREATE TABLE _TrackGenres (
  A TEXT NOT NULL REFERENCES Track(id) ON DELETE CASCADE,
  B TEXT NOT NULL REFERENCES Genre(id) ON DELETE CASCADE,
  UNIQUE(A, B)
);
CREATE INDEX _TrackGenres_A ON _TrackGenres(A);
CREATE INDEX _TrackGenres_B ON _TrackGenres(B);

-- Migrate existing genre strings to Genre records
INSERT INTO Genre (id, name, createdAt)
SELECT DISTINCT
  lower(hex(randomblob(16))),
  genre,
  unixepoch() * 1000
FROM Track
WHERE genre IS NOT NULL;

-- Link tracks to genres
INSERT INTO _TrackGenres (A, B)
SELECT
  t.id,
  g.id
FROM Track t
JOIN Genre g ON g.name = t.genre
WHERE t.genre IS NOT NULL;

-- Drop old genre column
ALTER TABLE Track DROP COLUMN genre;
```

### Flat Genre List (No Hierarchy)

Genres are a flat list, **not** hierarchical (no parent/child).

**Rationale:**

- Genre hierarchies are contentious (is "Grunge" a subgenre of "Rock" or "Alternative"?)
- Flat list is simpler to implement and understand
- Multi-genre tagging provides flexibility without hierarchy

**Example:**
Instead of:

```
Rock
  ├── Hard Rock
  ├── Progressive Rock
  └── Alternative Rock
```

Use flat list:

```
Rock
Hard Rock
Progressive Rock
Alternative Rock
```

A track can be tagged `["Rock", "Progressive Rock"]` without requiring hierarchy.

### Curator-Built Genre List

Start with **empty** genre list. Curators add genres as needed.

**Rationale:**

- Avoids imposing genre taxonomy
- Grows organically based on library content
- Curators know their music best

**Genre Creation:**

Curators can create genres:

1. **From track edit dialog**: Type new genre name, press Enter → creates genre
2. **From genre management page**: Dedicated "Add Genre" form

**Normalization:**

- Case-insensitive matching: "rock" matches "Rock"
- Trim whitespace
- No duplicate genres (unique constraint)

### Genre Management Page

Dedicated curator page for managing genres:

**Path:** `/curator/genres`

**Features:**

1. **List all genres** with usage counts

   ```
   Rock (1,234 tracks)
   Jazz (456 tracks)
   Classical (234 tracks)
   ```

2. **Merge genres** (duplicate cleanup)
   - Select 2+ genres → merge into one
   - All tracks retagged to target genre
   - Source genres deleted

3. **Rename genres**
   - Edit genre name
   - Updates all track relationships

4. **Delete genres**
   - Remove genre
   - Removes from all tracks
   - Confirmation dialog

5. **View tracks by genre**
   - Click genre → list of tracks with that genre
   - Filter/sort tracks

### UI Components

**Track Edit Dialog (Basic Tab):**

Replace single genre input with multi-genre selector:

```typescript
// Multi-select dropdown
<GenreSelect
  value={selectedGenres}      // string[]
  onChange={setSelectedGenres}
  onCreate={handleCreateGenre}
/>
```

**Features:**

- Dropdown shows all existing genres (searchable)
- Selected genres appear as removable pills/chips
- "Create new genre" option at bottom of dropdown
- Tag-style input: type genre name, press Enter to add

**Bulk Edit Dialog:**

Genre field becomes multi-select:

- Can add genres to all tracks
- Can remove genres from all tracks
- Can replace all genres

**Library Display:**

Track list item shows genres as pills:

```
Track Title
Artist Name • Rock · Alternative · Grunge
```

### Search & Filter Integration

**Global Search (FTS5):**

Update FTS5 index to include all genres:

```sql
-- Current (single genre)
INSERT INTO TrackFTS (title, artist, genre, ...)
VALUES ('Song', 'Artist', 'Rock', ...)

-- Multi-genre (space-separated)
INSERT INTO TrackFTS (title, artist, genre, ...)
VALUES ('Song', 'Artist', 'Rock Alternative Grunge', ...)
```

**Library Filter:**

Genre filter becomes multi-select:

- Show tracks matching **any** selected genre (OR logic)
- Example: Filter by ["Rock", "Jazz"] → shows tracks with either genre

### No Limit on Genre Count

Tracks can have unlimited genres. No hard limit (e.g., no "max 5 genres" rule).

**Rationale:**

- Curators know when to stop
- Artificial limits frustrating
- Database handles many-to-many efficiently

**Practical Limit:**
Most tracks have 1-3 genres. Edge case: 10+ genres is rare and acceptable.

### Backward Compatibility

**Audio Metadata Import:**

Existing audio metadata extraction returns `genre: string[]`:

```typescript
// app/utils/audio-metadata.server.ts
interface ExtractedAudioMetadata {
  genre?: string[]; // Already array!
  // ...
}
```

No changes needed. Just map array to Genre records:

```typescript
async function importTrackMetadata(metadata: ExtractedAudioMetadata) {
  // Create genres if they don't exist
  const genreRecords = await Promise.all(
    (metadata.genre || []).map((name) =>
      prisma.genre.upsert({
        where: { name },
        create: { name },
        update: {},
      }),
    ),
  );

  // Link to track
  await prisma.track.update({
    where: { id: trackId },
    data: {
      genres: {
        connect: genreRecords.map((g) => ({ id: g.id })),
      },
    },
  });
}
```

**YouTube Imports:**

YouTube doesn't provide genre. Tracks imported from YouTube start with no genres. Curators add genres during curation.

## Consequences

### Positive

- **Accurate tagging**: Tracks can have multiple genres without losing information
- **Better discovery**: Search and filter find more relevant tracks
- **Flexible**: No rigid hierarchy, curators decide genre usage
- **Curator-driven**: Genre list grows organically based on library

### Negative

- **Complexity**: Many-to-many relationship more complex than string field
- **Inconsistency risk**: Curators may use genres inconsistently ("Rock" vs "Rock Music")
- **Migration effort**: Existing single-genre tracks need review/expansion

### Trade-offs

**Why flat list instead of hierarchy?**

- Genre hierarchies are subjective and contentious
- Hierarchy adds UI/DB complexity
- Multi-tagging provides similar benefits (tag both "Rock" and "Hard Rock")

**Why curator-built instead of predefined list?**

- Avoids imposing external taxonomy
- Library-specific genres possible (e.g., "Local Artists")
- Curators have domain expertise

**Why no limit on genre count?**

- Trust curators to use judgment
- Hard limits frustrating when legitimate need for 10+ genres
- Database performance not an issue

**Why many-to-many instead of comma-separated string?**

- Referential integrity (can't delete in-use genre)
- Efficient querying (join instead of LIKE '%genre%')
- Proper normalization (genre name stored once, not repeated)

## Performance Considerations

**Query Performance:**

```sql
-- Find tracks with genre "Rock"
SELECT t.* FROM Track t
JOIN _TrackGenres tg ON t.id = tg.A
JOIN Genre g ON g.id = tg.B
WHERE g.name = 'Rock'

-- With index on Genre.name and join table indexes: fast
```

**FTS5 Rebuild:**

When genres change, FTS5 index must rebuild:

- Happens async (background job)
- Tracks temporarily unsearchable by new genre (acceptable)

**Genre Count Query:**

```sql
-- Count tracks per genre (for genre management page)
SELECT g.name, COUNT(tg.A) as trackCount
FROM Genre g
LEFT JOIN _TrackGenres tg ON g.id = tg.B
GROUP BY g.id
ORDER BY trackCount DESC
```

With proper indexes, fast even for 1000+ genres.

## Implementation Notes

### API Changes

**Track Edit Endpoint:**

```typescript
// POST /api/metadata/tracks/:id/edit
{
  title: "Song",
  artistId: "...",
  genreIds: ["genre-1", "genre-2", "genre-3"]  // Array of IDs
}
```

**Genre Management Endpoints:**

```typescript
// GET /api/curator/genres
→ { genres: [{ id, name, trackCount }] }

// POST /api/curator/genres
{ name: "Synthwave" }
→ { genre: { id, name } }

// PUT /api/curator/genres/:id
{ name: "Synth Wave" }
→ { genre: { id, name } }

// DELETE /api/curator/genres/:id
→ { success: true }

// POST /api/curator/genres/merge
{ sourceIds: ["g1", "g2"], targetId: "g3" }
→ { success: true, mergedCount: 123 }
```

### Genre Input Component

```typescript
// app/components/genre-select.tsx
function GenreSelect({ value, onChange, onCreate }) {
  const [query, setQuery] = useState("")
  const { data: genres } = useQuery(["genres"], fetchGenres)

  const filtered = genres.filter(g =>
    g.name.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div>
      <Label>Genres</Label>

      {/* Selected genres (pills) */}
      <div className="flex flex-wrap gap-2">
        {value.map(genreId => {
          const genre = genres.find(g => g.id === genreId)
          return (
            <Badge key={genreId} variant="secondary">
              {genre?.name}
              <button onClick={() => onChange(value.filter(id => id !== genreId))}>
                ×
              </button>
            </Badge>
          )
        })}
      </div>

      {/* Dropdown */}
      <Popover>
        <PopoverTrigger>
          <Input
            placeholder="Add genre..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </PopoverTrigger>
        <PopoverContent>
          {filtered.map(genre => (
            <button
              key={genre.id}
              onClick={() => {
                if (!value.includes(genre.id)) {
                  onChange([...value, genre.id])
                }
                setQuery("")
              }}
            >
              {genre.name} ({genre.trackCount} tracks)
            </button>
          ))}

          {query && !filtered.some(g => g.name.toLowerCase() === query.toLowerCase()) && (
            <button onClick={() => onCreate(query)}>
              Create "{query}"
            </button>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
```

## Alternatives Considered

### Hierarchical genre taxonomy

Parent-child genre relationships (Rock → Hard Rock → Metal).

**Rejected because:**

- Subjective which genres are "children" of which
- Complex UI for hierarchy management
- Flat + multi-tagging achieves similar goals

### Predefined genre list

Start with canonical list (e.g., MusicBrainz genres).

**Rejected because:**

- Imposes external taxonomy
- May not fit library content
- Curator-built more flexible

### Comma-separated genre string

Keep string field, allow "Rock, Alternative, Grunge".

**Rejected because:**

- Hard to query efficiently
- No referential integrity
- Messy data (inconsistent separators, typos)

### Single genre with subgenres

Keep single primary genre + optional subgenre field.

**Rejected because:**

- Arbitrary distinction between "genre" and "subgenre"
- Doesn't solve multi-genre need (track can be Rock+Jazz)

### Genre limit (max 5)

Cap genres per track at 5.

**Rejected because:**

- Arbitrary limit
- Frustrating when legitimate need for more
- No technical reason for limit

## References

- Related: ADR-031 (Curator Role), ADR-035 (Review Queue)
- Genre data: MusicBrainz genre list (reference, not imported)
- Audio metadata: `app/utils/audio-metadata.server.ts`
