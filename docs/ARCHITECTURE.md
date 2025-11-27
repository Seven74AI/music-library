# 🏗️ Music Library Architecture

## Type Safety Architecture

### Data Flow
```
YouTube API → Zod Validation → Prisma Types → Frontend
     ↓              ↓              ↓            ↓
External Data → Runtime Safety → DB Safety → Type Safety
```

### File Structure
```
app/types/
├── youtube-api.ts     # YouTube API types + Zod schemas
├── frontend/          # Frontend type definitions  
├── transformations.ts # API → DB transformation functions
└── youtube.ts         # OAuth types only

app/utils/
├── validation.ts      # Zod validation utilities
├── mock-generators.ts # Faker + MSW generators
└── service-playlist.server.ts # Updated service logic

app/config/
└── youtube.ts         # Configuration constants only

docs/
├── ARCHITECTURE.md    # This file - complete architecture overview
└── decisions/         # Architecture Decision Records (ADRs)
```

## Key Principles

1. **Zod validation for external APIs only**
2. **Prisma types for database operations**
3. **Direct transformations from API to Prisma**
4. **Dynamic mock data with Faker**
5. **Test isolation via database copy pattern**
6. **Clean separation of concerns**

## Type Safety Layers

### Layer 1: API Boundary Validation
- All YouTube API responses validated with Zod schemas
- Type-safe data flows from API to internal system
- Runtime validation catches API changes

### Layer 2: Database Type Safety
- Prisma types for compile-time safety
- Prisma handles database-level validation
- Type-safe queries and mutations with Prisma

### Layer 3: Transformation Safety
- Type-safe functions convert API data to Prisma input types
- Direct transformation from validated API data to Prisma types
- No redundant validation layers

### Layer 4: Mock Data Consistency
- Mock data generated with Faker matches real schemas
- Dynamic MSW handlers for per-test customization
- Predictable test data with realistic values

### Layer 5: Test Isolation
- Epic Stack's database copy pattern for isolation
- No custom cleanup needed
- Fast, reliable test execution

## Mock Data Generation Architecture

### Dual Mock System

We implement both **server-side mocking** and **client-side mocking** for maximum flexibility:

#### Server-Side Mocking (Development)
- **Purpose**: Quick development without API setup
- **Trigger**: `MOCKS=true` environment variable
- **Scope**: All YouTube API calls return mock data
- **Benefits**: No API quota usage, offline development, instant responses

#### Client-Side Mocking (Testing)
- **Purpose**: Comprehensive testing with MSW
- **Trigger**: MSW handlers in tests
- **Scope**: Network-level API interception
- **Benefits**: Realistic network behavior, test isolation, dynamic scenarios

### 5-Layer Mock System

#### LAYER 1: YouTube API Mock Generators
- `createFakerYouTubePlaylistItem()` - Generates realistic playlist items
- `createFakerYouTubePlaylist()` - Generates realistic playlists
- `createFakerYouTubeSearchResult()` - Generates search results
- `createFakerYouTubeVideo()` - Generates video details
- All generators validate with Zod schemas

#### LAYER 2: Database Mock Generators  
- `createFakerTrackData()` - Creates track data matching Prisma schema
- `createFakerServicePlaylistData()` - Creates playlist data
- Generates data for database insertion

#### LAYER 3: Database Record Creators
- `createFakerTrack()` - Actually creates database records
- `createFakerServicePlaylist()` - Creates playlist records
- `createFakerPlaylistWithTracks()` - Creates complete playlist with tracks
- Handles relationships and foreign keys

#### LAYER 4: MSW Handler Generators
- `createYouTubePlaylistsHandler()` - Dynamic playlist API mocking
- `createYouTubePlaylistItemsHandler()` - Dynamic playlist items mocking
- `createYouTubeSearchHandler()` - Dynamic search API mocking
- `createYouTubeVideoDetailsHandler()` - Dynamic video details mocking
- Per-test customization with realistic data

#### LAYER 5: Test Scenario Builders
- `createTestScenario()` - Complete test setup
- Creates both database records and API mock data
- Returns MSW handlers for immediate use
- Ultra-simple test setup

### Server-Side Mock Manager

#### MockManager Class
- **Purpose**: Environment-aware server-side mocking with sophisticated decision logic
- **Location**: `app/utils/mock-manager.server.ts`
- **Features**:
  - Environment-aware mocking strategy
  - Type-safe mock data generation
  - Static mock data constants for consistency
  - API key management
  - Zod validation for consistency
  - Environment-gated for safety

#### Environment-Aware Mocking Strategy
```typescript
// Mock Strategy:
// - Production: Real APIs (no mocks)
// - Development: Mock everything EXCEPT YouTube (real YouTube API)
// - Test/CI: Mock everything
// - Explicit override: MOCKS=true/false
```

#### YouTube-Specific Logic
```typescript
// YouTube Mock Strategy:
// - Development: Real YouTube API (no mocks)
// - Test/CI: Mock YouTube
// - Production: Real YouTube API
```

#### Usage
```bash
# Development (default): Real YouTube API, mock other services
npm run dev

# Development with explicit mocking: Mock everything
MOCKS=true npm run dev

# Test/CI: Mock everything automatically
npm test

# Production: Real APIs only
NODE_ENV=production npm start
```

#### Mocked Functions
- `youtube.server.ts`: `getUserPlaylists()`, `getPlaylist()`, `getPlaylistItems()`
- `youtube-search.server.ts`: `searchYouTubeVideos()`, `getYouTubeVideoDetails()`

#### API Key Management
```typescript
// Intelligent API key handling
MockManager.getApiKey() // Returns mock key or real API key
MockManager.isApiKeyRequired() // Checks if API key is needed
```

#### Static Mock Data
- `MOCK_DATA` constants for consistent test data
- `createMockVideoData()` for static video mock data
- `createMockPlaylistData()` for static playlist mock data
- `createMockPlaylistItem()` for static playlist item mock data

## Usage Patterns

### Adding New Features

1. **Define Zod schemas** in appropriate type file
2. **Add transformation functions** if needed
3. **Update mock generators** for testing
4. **Add validation calls** in service logic

### API Integration

```typescript
// Validate API response
const validatedData = validateYouTubeAPIResponse(
  rawApiResponse,
  YouTubePlaylistSchema
)

// Transform to database format
const dbData = transformYouTubePlaylistToServicePlaylist(
  validatedData,
  userId,
  serviceId
)

// Create database record
const record = await prisma.servicePlaylist.create({
  data: dbData
})
```

### Test Setup

```typescript
// Create complete test scenario
const scenario = await createTestScenario({
  playlistCount: 2,
  tracksPerPlaylist: 5
})

// Use dynamic MSW handlers
server.use(...scenario.handlers)

// Test with predictable data
await page.goto('/music/services/youtube')
```

## Configuration Management

### Constants Only
- `YOUTUBE_API_BASE_URL` - API base URL
- `YOUTUBE_SERVICE_ID` - Fixed service ID for consistency
- `YOUTUBE_ENDPOINTS` - API endpoint paths
- `YOUTUBE_RATE_LIMITS` - Rate limiting constants

### No Business Logic
- Configuration files contain ONLY constants
- No validation, transformation, or mock data
- Clean separation of concerns

## Error Handling

### Validation Errors
- Zod validation errors with detailed messages
- Type-safe error handling
- Clear error boundaries

### API Errors
- YouTube API errors handled gracefully
- Network errors with retry logic
- Quota errors with proper messaging

## Testing Strategy

### Test Isolation
- Epic Stack's database copy pattern
- Fresh database for each test
- No cleanup needed

### Mock Data
- Faker-generated realistic data
- Dynamic MSW handlers per test
- Predictable test scenarios

### Type Safety
- All test data validated with Zod
- Type-safe test utilities
- Compile-time error catching

## Performance Considerations

### Database Operations
- Efficient queries with proper indexing
- Batch operations where possible
- Connection pooling

### API Calls
- Rate limiting compliance
- Caching where appropriate
- Parallel requests when possible

### Test Performance
- Database copy is fast
- Mock data generation is efficient
- MSW handlers are lightweight

## Security

### API Keys
- Secure storage of API keys
- Environment-based configuration
- No keys in code or logs

### Data Validation
- All inputs validated with Zod
- SQL injection prevention
- XSS protection

### OAuth
- Secure token storage
- Token refresh handling
- Scope validation

## Monitoring & Observability

### Logging
- Structured logging with context
- Error tracking and alerting
- Performance monitoring

### Metrics
- API call success rates
- Database query performance
- Test execution times

## Future Extensibility

### Adding New Services
1. Create service-specific types
2. Add transformation functions
3. Update mock generators
4. Add service configuration

### Adding New Features
1. Extend existing schemas
2. Add new transformation functions
3. Update mock data generators
4. Add comprehensive tests

## Migration Guide

### From Old System
1. Replace manual validation with Zod
2. Update mock data to use Faker
3. Replace static MSW handlers with dynamic ones
4. Update tests to use `createTestScenario`

### Breaking Changes
- All API responses must be validated
- Mock data structure changes
- Test setup pattern changes

## Troubleshooting

### Common Issues

#### Type Errors
- Ensure all API responses are validated
- Check Zod schema definitions
- Verify transformation functions

#### Test Failures
- Check mock data matches schemas
- Verify MSW handlers are correct
- Ensure database is properly seeded

#### Performance Issues
- Check database query efficiency
- Verify API rate limiting
- Monitor test execution times

### Debugging

#### API Issues
- Check API key configuration
- Verify request parameters
- Monitor API response structure

#### Database Issues
- Check Prisma schema
- Verify foreign key relationships
- Monitor query performance

#### Test Issues
- Check mock data generation
- Verify MSW handler setup
- Ensure test isolation

## Contributing

### Code Style
- Use TypeScript strict mode
- Follow existing patterns
- Add comprehensive JSDoc comments

### Testing
- Write tests for all new features
- Use `createTestScenario` for setup
- Ensure test isolation

### Documentation
- Update this file for architectural changes
- Add JSDoc comments to new functions
- Create ADRs for significant decisions

## References

- [Zod Documentation](https://zod.dev/)
- [Faker.js Documentation](https://fakerjs.dev/)
- [MSW Documentation](https://mswjs.io/)
- [Epic Stack Documentation](https://epicweb.dev/epic-stack)
- [Prisma Documentation](https://www.prisma.io/docs/)
