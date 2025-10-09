# 🎭 Mocking System Documentation

## Overview

Our application implements a **dual mocking system** that provides both server-side and client-side mocking capabilities for maximum flexibility during development and testing.

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐
│   Development   │    │     Testing     │
│                 │    │                 │
│ Server-Side     │    │ Client-Side     │
│ MockManager     │    │ MSW Handlers    │
│                 │    │                 │
│ MOCKS=true      │    │ createTestScenario()
└─────────────────┘    └─────────────────┘
         │                       │
         ▼                       ▼
┌─────────────────────────────────────────┐
│           Mock Data Generation          │
│                                         │
│  Faker.js → Zod Validation → Type-Safe │
└─────────────────────────────────────────┘
```

## 🚀 Server-Side Mocking (Development)

### Purpose
Environment-aware server-side mocking with sophisticated decision logic for development convenience, offline development, and API quota conservation.

### Environment-Aware Mocking Strategy

The `MockManager` implements a sophisticated environment-based decision system:

```typescript
// Mock Strategy:
// - Production: Real APIs (no mocks)
// - Development: Mock everything EXCEPT YouTube (real YouTube API)
// - Test/CI: Mock everything
// - Explicit override: MOCKS=true/false
```

### YouTube-Specific Logic

YouTube has special handling in the mocking strategy:

```typescript
// YouTube Mock Strategy:
// - Development: Real YouTube API (no mocks)
// - Test/CI: Mock YouTube
// - Production: Real YouTube API
```

This means that in development, YouTube uses the real API by default, while other services are mocked. This allows developers to test with real YouTube data while avoiding API quota usage for other services.

### How to Enable

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

### What Gets Mocked

#### YouTube Service (`app/utils/youtube.server.ts`)
- `getUserPlaylists()` - Returns mock user playlists
- `getPlaylist()` - Returns mock playlist details
- `getPlaylistItems()` - Returns mock playlist items

#### YouTube Search (`app/utils/youtube-search.server.ts`)
- `searchYouTubeVideos()` - Returns mock search results
- `getYouTubeVideoDetails()` - Returns mock video details

### Mock Data Features
- ✅ **Environment-Aware**: Sophisticated environment-based decision logic
- ✅ **Static Mock Data**: Consistent mock data using predefined constants
- ✅ **Type Safety**: All mock data validated with Zod schemas
- ✅ **API Key Management**: Intelligent API key handling
- ✅ **Configurable**: Easy to customize mock data per scenario

### Development Benefits
- 🚀 **Smart Defaults**: Real YouTube API in development by default
- 🚀 **No API Quota**: Mock other services to save quota
- 🚀 **Fast Development**: Instant responses for testing
- 🚀 **Offline Development**: Works without internet connection
- 🚀 **Predictable Data**: Consistent mock data for reliable testing

### Production Safety
- 🔒 **Environment Gated**: Sophisticated environment detection
- 🔒 **No Production Impact**: Mocking disabled in production by default
- 🔒 **Type Safe**: Same validation as real API responses
- 🔒 **API Key Management**: Automatic API key handling based on environment

### MockManager Class

The `MockManager` class (`app/utils/mock-manager.server.ts`) provides the core functionality for server-side mocking.

#### Key Methods

```typescript
// Environment detection
MockManager.isEnabled() // General mocking enabled
MockManager.isYouTubeEnabled() // YouTube-specific mocking

// API key management
MockManager.getApiKey() // Returns mock key or real API key
MockManager.isApiKeyRequired() // Checks if API key is needed

// Mock data generation
MockManager.getMockUserPlaylists() // Mock user playlists
MockManager.getMockPlaylist(playlistId) // Mock playlist by ID
MockManager.getMockPlaylistItems(playlistId, count) // Mock playlist items
MockManager.getMockVideoDetails(videoId) // Mock video details
MockManager.getMockSearchResults(query) // Mock search results

// Logging
MockManager.log(message) // Log mock activity
```

#### Static Mock Data

The MockManager includes predefined mock data constants for consistency:

```typescript
// Mock data constants
MOCK_DATA = {
  VIDEO_TITLE: 'Never Gonna Give You Up',
  VIDEO_ARTIST: 'Rick Astley',
  VIDEO_PUBLISHED_AT: '2009-10-25T06:57:33Z',
  CHANNEL_TITLE: 'Mock Channel',
  PLAYLIST_TITLE: 'My Test Playlist',
  PLAYLIST_DESCRIPTION: 'A test playlist for testing',
  THUMBNAIL_BASE_URL: 'https://example.com/thumb',
}

// Mock data generators
createMockVideoData(videoId, options) // Static video mock data
createMockPlaylistData(playlistId, options) // Static playlist mock data
createMockPlaylistItem(playlistId, index, options) // Static playlist item mock data
```

## 🧪 Client-Side Mocking (Testing)

### Purpose
Comprehensive testing with realistic network behavior and test isolation.

### How to Use
```typescript
import { createTestScenario } from '#app/utils/mock-generators'

// Create complete test scenario
const scenario = await createTestScenario({
  playlistCount: 2,
  tracksPerPlaylist: 5
})

// Use MSW handlers
server.use(...scenario.handlers)
```

### Features
- **Network-Level Interception**: MSW intercepts HTTP requests
- **Dynamic Scenarios**: Per-test customization
- **Realistic Behavior**: Simulates real network conditions
- **Test Isolation**: Each test gets fresh mock data

## 📁 File Structure

```
app/utils/
├── mock-manager.server.ts    # Server-side mocking
├── mock-generators.ts        # Mock data generation
└── validation.ts            # Zod validation utilities

tests/mocks/
├── index.ts                 # MSW server setup
└── [other-mocks].ts        # Additional mock handlers
```

## 🔧 MockManager API

### Core Methods

#### `isYouTubeEnabled()`
```typescript
if (MockManager.isYouTubeEnabled()) {
  // Return mock data
}
```

#### `getMockUserPlaylists()`
```typescript
const mockPlaylists = MockManager.getMockUserPlaylists()
// Returns: YouTubePlaylistListResponse with realistic data
```

#### `getMockPlaylist(playlistId)`
```typescript
const mockPlaylist = MockManager.getMockPlaylist('PLtest123')
// Returns: YouTubePlaylistListResponse with single playlist
```

#### `getMockPlaylistItems(playlistId, count)`
```typescript
const mockItems = MockManager.getMockPlaylistItems('PLtest123', 5)
// Returns: YouTubePlaylistItemListResponse with 5 items
```

#### `getMockVideoDetails(videoId)`
```typescript
const mockVideo = MockManager.getMockVideoDetails('video123')
// Returns: VideoData with realistic video details
```

## 🎯 Usage Examples

### Development Workflow
```bash
# 1. Enable mocking for development
MOCKS=true npm run dev

# 2. All YouTube API calls return mock data
# 3. Develop features without API quota concerns
# 4. Test with predictable, realistic data
```

### Testing Workflow
```typescript
// 1. Create test scenario
const scenario = await createTestScenario({
  playlistCount: 2,
  tracksPerPlaylist: 5
})

// 2. Use MSW handlers
server.use(...scenario.handlers)

// 3. Run tests with realistic mock data
await page.goto('/music/services/youtube')
```

### Custom Mock Data
```typescript
// Generate custom mock data
const customPlaylist = createFakerYouTubePlaylist('PLcustom', {
  title: 'My Custom Playlist',
  description: 'Custom description',
  itemCount: 10
})
```

## 🔍 Debugging

### Mock Activity Logging
```typescript
// MockManager automatically logs activity when MOCKS=true
[MockManager] Generating mock YouTube playlists
[MockManager] Generating mock YouTube playlist: PLtest123
```

### MSW Debugging
```typescript
// MSW provides network-level debugging
server.listen({
  onUnhandledRequest: 'warn'
})
```

## 🚨 Troubleshooting

### Mock Data Not Working
1. **Check Environment**: Ensure `MOCKS=true` is set
2. **Check Logs**: Look for `[MockManager]` log messages
3. **Check Functions**: Verify the function is using MockManager

### Type Errors
1. **Check Imports**: Ensure proper imports from mock-generators
2. **Check Schemas**: Verify Zod schemas match API structure
3. **Check Transformations**: Ensure transformation functions are correct

### MSW Issues
1. **Check Handlers**: Verify MSW handlers are properly set up
2. **Check Network**: Ensure requests are being intercepted
3. **Check Scenarios**: Verify test scenarios are creating correct data

## 🔮 Future Enhancements

### Planned Features
- **Custom Mock Scenarios**: User-defined mock data scenarios
- **Mock Data Persistence**: Save/load mock data configurations
- **API Response Simulation**: Simulate different API response scenarios
- **Performance Mocking**: Simulate slow/fast API responses

### Extension Points
- **New Services**: Easy to add mocking for new services (Spotify, etc.)
- **Custom Generators**: Add service-specific mock data generators
- **Advanced Scenarios**: Complex test scenarios with multiple services

## 📚 Related Documentation

- [Architecture Overview](./ARCHITECTURE.md) - Complete system architecture
- [Type Safety Guide](./app/types/README.md) - Type system documentation
- [Testing Guide](./docs/testing.md) - Testing strategies and patterns
- [Development Guide](./docs/development.md) - Development workflows

## 🤝 Contributing

### Adding New Mock Data
1. Add generator function to `mock-generators.ts`
2. Add corresponding MockManager method
3. Update documentation
4. Add tests for new mock data

### Extending Mock Scenarios
1. Update `createTestScenario()` function
2. Add new MSW handlers if needed
3. Update test documentation
4. Verify test isolation

---

**Need help?** Check the [troubleshooting section](#-troubleshooting) or refer to the [architecture documentation](./ARCHITECTURE.md).
