# ADR-001: Type Safety with Zod Validation

## Status
Accepted

## Context
The Music Library application integrates with YouTube API and stores data in a database. We needed to improve type safety across the entire data flow from API responses to database storage and frontend display.

### Problems with Previous Approach
1. **Manual Type Definitions**: TypeScript interfaces were manually defined and could drift from actual API responses
2. **No Runtime Validation**: API responses were assumed to match TypeScript types, leading to runtime errors
3. **Unsafe Transformations**: Data transformations between API and database formats were not type-safe
4. **Inconsistent Mock Data**: Test mock data didn't match real API structure
5. **Complex Error Handling**: Multiple error handling patterns across the codebase
6. **Poor Test Isolation**: Tests required complex cleanup and setup

### Requirements
- Compile-time type safety throughout the application
- Runtime validation of all external data
- Type-safe data transformations
- Reliable test data generation
- Simple test setup and isolation
- Easy to extend for new features

## Decision
Implement a hybrid type safety architecture using Zod for external API validation and Prisma types for database operations, with clean separation of concerns and dynamic mock data generation.

### Architecture Components

#### 1. Hybrid Type System
- **External APIs**: Zod schemas for runtime validation of unpredictable external data
- **Database Operations**: Prisma types for compile-time safety and built-in validation
- **Frontend**: Type-safe interfaces derived from Prisma types
- **Transformations**: Direct conversion from validated API data to Prisma input types

#### 2. Layered Type System
```
YouTube API → Zod Validation → Prisma Types → Frontend Types
     ↓              ↓              ↓            ↓
External Data → Runtime Safety → DB Safety → Type Safety
```

#### 3. Pragmatic Transformations
- Direct transformation from validated API data to Prisma input types
- No redundant validation layers for database operations
- Prisma handles database-level validation and constraints
- Focus on API boundary validation where it adds real value

#### 4. Dynamic Mock Data System
- 5-layer mock data generation architecture
- Faker-based realistic data generation
- MSW handlers for API mocking
- Per-test customization capabilities

#### 5. Test Isolation Strategy
- Epic Stack's database copy pattern
- No custom cleanup needed
- Fast, reliable test execution
- Predictable test scenarios

## Consequences

### Positive
- ✅ **Compile-time Type Safety**: All data flows are type-safe
- ✅ **Runtime Validation**: API changes are caught at runtime
- ✅ **Better Error Messages**: Zod provides detailed validation errors
- ✅ **Reliable Tests**: Mock data matches real API structure
- ✅ **Easy Debugging**: Clear error boundaries and validation points
- ✅ **Future-Proof**: Easy to extend with new features
- ✅ **Developer Experience**: IntelliSense support throughout
- ✅ **Test Performance**: Fast test execution with database copy pattern

### Negative
- ❌ **Initial Complexity**: More setup required initially
- ❌ **Learning Curve**: Team needs to understand Zod patterns
- ❌ **Slightly More Verbose**: More code for validation and transformation
- ❌ **Migration Effort**: Existing code needs to be updated

### Neutral
- 🔄 **File Structure Changes**: New file organization required
- 🔄 **Import Changes**: New import paths for types and utilities
- 🔄 **Test Pattern Changes**: New test setup patterns

## Implementation Details

### File Structure
```
app/types/
├── youtube-api.ts     # YouTube API types + Zod schemas (external validation)
├── transformations.ts # API → Prisma transformation functions
├── frontend/          # Frontend type definitions
└── youtube.ts         # OAuth types only

app/utils/
├── validation.ts      # API validation utilities (Zod for external APIs)
├── mock-generators.ts # Faker + MSW generators
└── service-playlist.server.ts # Updated service logic

app/config/
└── youtube.ts         # Configuration constants only
```

### Key Patterns

#### API Response Validation (External APIs Only)
```typescript
const validatedData = validateYouTubeAPIResponse(
  rawApiResponse,
  YouTubePlaylistSchema
)
```

#### Database Operations (Prisma Types)
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

#### Type-Safe Transformations (API → Prisma)
```typescript
const trackData = transformYouTubePlaylistItemToTrack(
  validatedYouTubeItem,
  serviceId
) // Returns Prisma.TrackCreateInput
```

#### Test Scenario Setup
```typescript
const scenario = await createTestScenario({
  playlistCount: 2,
  tracksPerPlaylist: 5
})
server.use(...scenario.handlers)
```

### Mock Data Architecture
1. **Layer 1**: YouTube API mock generators with Zod validation
2. **Layer 2**: Database mock generators matching Prisma schema
3. **Layer 3**: Database record creators with relationships
4. **Layer 4**: MSW handler generators for dynamic API mocking
5. **Layer 5**: Test scenario builders for complete test setup

## Alternatives Considered

### Alternative 1: Manual Type Definitions Only
- **Pros**: Simpler initial setup
- **Cons**: No runtime validation, types can drift from reality
- **Decision**: Rejected - runtime validation is crucial for API integration

### Alternative 2: Joi Validation
- **Pros**: Mature validation library
- **Cons**: No TypeScript integration, separate type definitions needed
- **Decision**: Rejected - Zod provides better TypeScript integration

### Alternative 3: Yup Validation
- **Pros**: Popular validation library
- **Cons**: Less TypeScript-friendly than Zod
- **Decision**: Rejected - Zod has better TypeScript support

### Alternative 4: Custom Validation
- **Pros**: Full control over validation logic
- **Cons**: Significant development effort, maintenance burden
- **Decision**: Rejected - Zod provides proven validation patterns

### Alternative 5: Static Mock Data
- **Pros**: Simpler mock setup
- **Cons**: Less flexible, doesn't match real API structure
- **Decision**: Rejected - dynamic mocks provide better test reliability

## Migration Strategy

### Phase 1: Foundation
1. Create new type files with Zod schemas
2. Create validation utilities
3. Create transformation functions
4. Create mock data generators

### Phase 2: Integration
1. Update service logic to use new types
2. Update tests to use new mock system
3. Refactor configuration files
4. Update existing type files

### Phase 3: Cleanup
1. Remove old mock files
2. Update import statements
3. Run full test suite
4. Update documentation

## Success Metrics

### Technical Metrics
- [ ] Zero TypeScript errors in codebase
- [ ] Zero `any` types in YouTube-related code
- [ ] All API responses validated with Zod
- [ ] All tests pass with new mock system
- [ ] Test execution time < 30 seconds

### Quality Metrics
- [ ] All new features use type-safe patterns
- [ ] Mock data matches real API structure
- [ ] Error messages are clear and actionable
- [ ] Code is self-documenting with JSDoc

### Developer Experience Metrics
- [ ] IntelliSense works throughout codebase
- [ ] New developers can understand architecture quickly
- [ ] Adding new features follows established patterns
- [ ] Debugging is easier with clear error boundaries

## Future Considerations

### Extensibility
- Easy to add new API integrations
- Simple to extend mock data system
- Straightforward to add new validation rules

### Performance
- Zod validation is fast enough for our use case
- Database copy pattern is efficient for tests
- Mock data generation is lightweight

### Maintenance
- Zod schemas need to be kept in sync with API changes
- Mock data generators need updates when API changes
- Documentation needs to be maintained

## References

- [Zod Documentation](https://zod.dev/)
- [Faker.js Documentation](https://fakerjs.dev/)
- [MSW Documentation](https://mswjs.io/)
- [Epic Stack Documentation](https://epicweb.dev/epic-stack)
- [Prisma Documentation](https://www.prisma.io/docs/)

## Related ADRs

- None yet (this is the first ADR)

## Revision History

- **2024-01-XX**: Initial version
- **2024-01-XX**: Added implementation details and migration strategy
