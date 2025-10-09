# app/types/README.md

## Type Safety Architecture

This directory contains all type definitions with Zod validation for the Music Library application.

## Files Overview

### `youtube-api.ts` - YouTube API Types & Zod Schemas
- **Purpose**: Defines Zod schemas and TypeScript types for YouTube API responses
- **Contains**: 
  - `YouTubePlaylistItemSchema` - Playlist item validation
  - `YouTubePlaylistSchema` - Playlist validation
  - `YouTubeSearchResultSchema` - Search result validation
  - `YouTubeVideoSchema` - Video details validation
  - API response wrapper schemas
  - Inferred TypeScript types
- **Usage**: Validate all YouTube API responses before processing

### `frontend/` - Frontend Type Definitions
- **Purpose**: Defines type-safe interfaces for frontend components
- **Contains**:
  - `playlists.ts` - Playlist-related frontend types
  - `tracks.ts` - Track-related frontend types
  - `youtube.ts` - YouTube-specific frontend types
  - `forms.ts` - Form and action result types
  - `stats.ts` - Statistics and dashboard types
  - `utils.ts` - Utility types (pagination, filters, etc.)
- **Usage**: Type-safe frontend components and data flow

### `transformations.ts` - Type-Safe Transformation Functions
- **Purpose**: Contains functions to transform validated YouTube API data into Prisma input types
- **Contains**:
  - `transformYouTubeItemToTrack()` - Convert playlist item to Prisma TrackCreateInput
  - `transformYouTubePlaylistToServicePlaylist()` - Convert playlist to Prisma ServicePlaylistCreateInput
  - `transformYouTubeVideoToTrack()` - Convert video details to Prisma TrackCreateInput
- **Usage**: Transform validated API data to Prisma input types

### `youtube.ts` - OAuth Types Only
- **Purpose**: Contains only OAuth-related types (legacy file)
- **Contains**:
  - `YouTubeTokenData` - OAuth token structure
  - `ValidatedOAuthConnection` - Validated OAuth connection
- **Usage**: OAuth token handling and validation

## Usage Patterns

### API Response Validation
```typescript
import { validateYouTubeAPIResponse } from '#app/utils/validation'
import { YouTubePlaylistSchema } from '#app/types/youtube-api'

// Validate API response
const validatedData = validateYouTubeAPIResponse(
  rawApiResponse,
  YouTubePlaylistSchema
)
```

### Database Operations (Prisma Types)
```typescript
import { type Prisma } from '@prisma/client'

// Use Prisma types directly
const trackData: Prisma.TrackCreateInput = {
  title: validatedData.snippet.title,
  artist: validatedData.snippet.channelTitle,
  // ... other fields
}

// Prisma handles validation
const track = await prisma.track.create({ data: trackData })
```

### Data Transformation
```typescript
import { transformYouTubeItemToTrack } from '#app/types/transformations'

// Transform API data to database format
const trackData = transformYouTubeItemToTrack(
  validatedYouTubeItem,
  serviceId
)
```

### Type-Safe Database Operations
```typescript
import { type Prisma } from '@prisma/client'

// Use Prisma types directly
const trackData: Prisma.TrackCreateInput = {
  title: 'Song Title',
  artist: 'Artist Name',
  // ... other fields
}

// Prisma handles validation and type safety
const track = await prisma.track.create({ data: trackData })

// Query with Prisma types
const playlist = await prisma.servicePlaylist.findUnique({
  where: { id: playlistId }
})
```

## Key Principles

### 1. Hybrid Validation Strategy
- External APIs: Zod validation for runtime safety
- Database operations: Prisma types for compile-time safety
- No `any` types allowed
- Runtime validation catches API changes

### 2. Prisma-First Database Types
- Use Prisma's generated types directly
- Prisma handles database-level validation
- Single source of truth for database schema

### 3. Direct Transformations
- Transform validated API data directly to Prisma input types
- No redundant validation layers
- Type-safe transformations without extra complexity

### 4. Clear Separation
- API types with Zod validation for external data
- Prisma types for database operations
- Frontend types for UI components
- Transformation functions bridge API to Prisma

## Adding New Types

### 1. Define Zod Schema
```typescript
export const NewEntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  // ... other fields
})
```

### 2. Infer TypeScript Type
```typescript
export type NewEntity = z.infer<typeof NewEntitySchema>
```

### 3. Add to Appropriate File
- API-related schemas → `youtube-api.ts`
- Database-related schemas → `database.ts`
- Transformation functions → `transformations.ts`

### 4. Add Validation
```typescript
// Use existing validation utilities
import { validateDatabaseInput } from '#app/utils/validation'

// Validate database input
const validatedData = validateDatabaseInput(rawInput, NewEntitySchema)
```

## Testing with Types

### Mock Data Generation
```typescript
import { createFakerYouTubePlaylistItem } from '#app/utils/mock-generators'

// Generate type-safe mock data
const mockItem = createFakerYouTubePlaylistItem('PL123', 0, {
  title: 'Test Video',
  duration: 180
})
```

### Test Scenarios
```typescript
import { createTestScenario } from '#app/utils/mock-generators'

// Create complete test scenario
const scenario = await createTestScenario({
  playlistCount: 2,
  tracksPerPlaylist: 5
})
```

### Server-Side Mocking (Development)
```typescript
// Environment-aware server-side mocking
// Development (default): Real YouTube API, mock other services
// MOCKS=true: Mock everything
// Test/CI: Mock everything automatically

// All YouTube API calls will return mock data when enabled
const playlists = await youtubeService.getUserPlaylists(accessToken)
// Returns: Realistic mock playlists with type safety
```

### YouTube Mocking
```typescript
// Simple environment variable control
if (process.env.YOUTUBE_MOCKS === 'true') {
  // YouTube API will return mock data
}

// Usage examples:
// npm run dev                    → Real YouTube API (default)
// npm run dev:youtube-mocks      → Mocked YouTube API
// npm run dev:no-youtube-mocks   → Real YouTube API (explicit)
```

**Environment Variables:**
- `YOUTUBE_MOCKS=true` → Use mocked YouTube API
- `YOUTUBE_MOCKS=false` → Use real YouTube API (overrides MOCKS)
- `YOUTUBE_MOCKS` not set → Follow `MOCKS` environment variable
- `MOCKS=true` → Enable other service mocks (email, storage, etc.)

## Common Patterns

### Optional Fields
```typescript
export const SchemaWithOptional = z.object({
  required: z.string(),
  optional: z.string().optional(),
  nullable: z.string().nullable(),
})
```

### Nested Objects
```typescript
export const NestedSchema = z.object({
  id: z.string(),
  details: z.object({
    name: z.string(),
    description: z.string().optional(),
  }),
})
```

### Arrays
```typescript
export const ArraySchema = z.object({
  items: z.array(z.string()),
  counts: z.array(z.number()),
})
```

### Unions
```typescript
export const UnionSchema = z.object({
  type: z.union([z.literal('video'), z.literal('playlist')]),
  status: z.enum(['active', 'inactive', 'pending']),
})
```

## Error Handling

### Validation Errors
```typescript
import { ValidationError } from '#app/utils/validation'

try {
  const validated = validateYouTubeAPIResponse(data, schema)
} catch (error) {
  if (error instanceof ValidationError) {
    console.error('Validation failed:', error.errors)
  }
}
```

### Safe Validation
```typescript
import { safeValidate } from '#app/utils/validation'

const result = safeValidate(data, schema)
if (result.success) {
  // Use result.data
} else {
  // Handle result.error
}
```

## Best Practices

### 1. Always Validate
- Never trust external data
- Validate at API boundaries
- Validate database inputs

### 2. Use Inferred Types
- Don't manually define types
- Use `z.infer<typeof Schema>`
- Keep schemas and types in sync

### 3. Transform Safely
- Validate before transforming
- Use type-safe transformation functions
- Handle errors gracefully

### 4. Document Schemas
- Add JSDoc comments to schemas
- Explain complex validation rules
- Provide usage examples

### 5. Test Types
- Test schema validation
- Test transformation functions
- Test error handling

## Troubleshooting

### Type Errors
- Check Zod schema definitions
- Verify type inference
- Ensure all fields are properly typed

### Validation Errors
- Check API response structure
- Verify schema matches API
- Handle optional fields correctly

### Transformation Errors
- Validate input before transformation
- Check transformation function logic
- Handle missing fields gracefully

## Related Files

- `app/utils/validation.ts` - Validation utilities
- `app/utils/mock-generators.ts` - Mock data generation
- `app/config/youtube.ts` - Configuration constants
- `docs/ARCHITECTURE.md` - Complete architecture overview
