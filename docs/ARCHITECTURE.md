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

## Audio Archive Worker System

### Overview
The audio archive worker is a background service that automatically downloads and processes YouTube audio tracks for the music library. It features intelligent scheduling, admin controls, and robust error handling.

### Architecture Components

#### Core Workers
- **`audio-worker.ts`** - Main worker orchestrator with scheduling and state management
- **`audio-queue.ts`** - Queue processing and track management
- **`audio-archive.ts`** - Individual track download and processing
- **`audio-worker-control.ts`** - Worker state management and cleanup utilities

#### Key Features

##### Admin-Interruptible Long Breaks
- **Polling-based system**: Worker checks for admin commands every 30 seconds during long breaks
- **Non-blocking**: Replaces blocking `setTimeout` with responsive polling
- **Admin control**: Long breaks can be interrupted via admin interface
- **Configurable duration**: 1-2 hour random breaks (reduced from 3-4 hours)

##### Intelligent Scheduling
- **Fast processing**: 2-minute intervals (reduced from 5 minutes)
- **Concurrent downloads**: Configurable concurrent track processing
- **Priority system**: Priority tracks processed first, then FIFO order
- **Retry logic**: Automatic retry with exponential backoff

##### Robust Download System
- **yt-dlp integration**: Professional-grade YouTube downloader
- **Random user agents**: Anti-detection measures
- **Sleep intervals**: Random delays to avoid rate limiting
- **Quality settings**: Best audio quality with metadata embedding

##### Error Handling & Monitoring
- **Comprehensive error tracking**: Error history with retry counts
- **Graceful degradation**: Failed tracks marked for retry or permanent failure
- **Worker state tracking**: Real-time status monitoring
- **Cleanup utilities**: Automatic cleanup of stuck tracks

### Configuration

#### Environment Variables
```bash
# Enable/disable audio archiving
AUDIO_ARCHIVE_ENABLED=true

# Worker interval (milliseconds)
AUDIO_ARCHIVE_INTERVAL_MS=120000  # 2 minutes

# Concurrent download limit
MAX_CONCURRENT_DOWNLOADS=3
```

#### Worker States
- **`running`** - Normal operation, processing queue
- **`paused`** - Manually paused by admin
- **`long_break`** - Automatic break mode (interruptible)

### Admin Interface Integration

#### Worker Control Actions
- **Pause Worker**: Temporarily stop processing
- **Resume Worker**: Restart processing with new long break schedule
- **Break Long Pause**: Interrupt current long break immediately
- **Retry Track**: Force retry of failed tracks with priority
- **Archive Now**: Queue specific tracks for immediate processing

#### Real-time Monitoring
- **Worker status**: Current state and time until next break
- **Processing count**: Number of tracks currently being processed
- **Queue statistics**: Pending, processing, and failed track counts
- **Last run time**: When the worker last processed the queue

### Performance Optimizations

#### Download Efficiency
- **Random sleep intervals**: 2-5 second delays between downloads
- **User agent rotation**: Multiple realistic browser signatures
- **Fragment retries**: Automatic retry of failed download fragments
- **Quality optimization**: Best audio quality with efficient processing

#### Resource Management
- **Concurrent limits**: Configurable simultaneous download limit
- **Memory management**: Temporary file cleanup after processing
- **Database efficiency**: Batch operations and optimized queries
- **Worker state persistence**: Database-backed state management

### Error Recovery

#### Automatic Retry System
- **Retry attempts**: Up to 3 attempts per track
- **Exponential backoff**: Increasing delays between retries
- **Error classification**: Categorized error types for appropriate handling
- **Permanent failure**: Tracks marked as failed after max retries

#### Cleanup Procedures
- **Stuck track detection**: Automatic identification of orphaned processing
- **Worker restart recovery**: Clean state initialization on restart
- **Temporary file cleanup**: Automatic removal of failed download files
- **Database consistency**: State synchronization across worker restarts

### Security Considerations

#### Download Security
- **No authentication required**: yt-dlp works without OAuth tokens
- **Rate limiting compliance**: Respects YouTube's rate limits
- **User agent spoofing**: Realistic browser signatures
- **Temporary file isolation**: Secure temporary file handling

#### Admin Security
- **Role-based access**: Admin-only worker controls
- **State validation**: Proper state transition validation
- **Error sanitization**: Safe error message handling
- **Audit logging**: Track all admin actions

### Monitoring & Observability

#### Logging Strategy
- **Structured logging**: JSON-formatted logs with context
- **Error tracking**: Detailed error information with stack traces
- **Performance metrics**: Download times and success rates
- **Admin action logging**: All control actions logged

#### Health Checks
- **Worker status monitoring**: Real-time status checks
- **Queue health**: Track processing success rates
- **Resource usage**: Monitor memory and CPU usage
- **Database connectivity**: Verify database access

### Future Enhancements

#### Planned Features
- **Multi-service support**: Extend to other audio sources
- **Quality selection**: User-configurable audio quality
- **Batch processing**: Optimized bulk operations
- **Advanced scheduling**: Time-based processing windows

#### Scalability Improvements
- **Horizontal scaling**: Multiple worker instances
- **Load balancing**: Distribute processing across workers
- **Queue partitioning**: Separate queues for different priorities
- **Resource optimization**: Dynamic resource allocation

## References

- [Zod Documentation](https://zod.dev/)
- [Faker.js Documentation](https://fakerjs.dev/)
- [MSW Documentation](https://mswjs.io/)
- [Epic Stack Documentation](https://epicweb.dev/epic-stack)
- [Prisma Documentation](https://www.prisma.io/docs/)
- [yt-dlp Documentation](https://github.com/yt-dlp/yt-dlp)
