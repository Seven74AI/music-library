# E2E Testing Guide

## Test Patterns

### 1. Playwright Fixtures (Preferred)
Use for all E2E tests to ensure test isolation and automatic cleanup.

**Available Fixtures:**
- `login()` - Creates user and logs in
- `insertNewUser()` - Creates user without login
- `insertNewTrack()` - Creates track, optionally adds to user library
- `insertNewPlaylist()` - Creates service playlist

**Example:**
```typescript
test('example', async ({ page, login, insertNewTrack }) => {
  const user = await login()
  const track = await insertNewTrack({ title: 'Test' }, user.id)
  await page.goto('/library')
  // Test UI
})
```

**Why:** Fixtures automatically clean up after each test, ensuring test isolation even in parallel execution.

### 2. Server-Side API Mocks

YouTube API calls are mocked automatically when `MOCKS=true` (E2E tests run with this enabled).

**How it works:**
- `app/utils/youtube.server.ts` checks `shouldMockYouTube()`
- Returns mock data instead of calling real YouTube API
- Mock data defined in `mock-generators.ts`

**Example:**
```typescript
test('YouTube integration', async ({ page, login, insertYouTubeConnection }) => {
  const user = await login()
  await insertYouTubeConnection(user.id) // Creates connection in DB
  await page.goto('/music/services/youtube/playlists')
  // Server returns mock playlists automatically
})
```

### 3. Direct Prisma (Avoid)

Only use for complex edge cases not covered by fixtures.

```typescript
// Avoid this pattern - use fixtures instead
await prisma.servicePlaylist.create({ ... })
```

## Best Practices

1. **Never use `beforeEach`/`afterEach` for cleanup** - Use fixtures instead
2. **Don't delete all data** - Only clean up what you created (fixtures do this)
3. **Test isolation** - Each test should work independently
4. **Descriptive names** - Make test purpose clear from the name
5. **Parallel-safe** - Tests must not interfere with each other

## Common Mistakes

❌ **Bad:**
```typescript
test.beforeEach(async () => {
  await prisma.connection.deleteMany({}) // Deletes ALL connections!
})
```

✅ **Good:**
```typescript
test('example', async ({ login, insertYouTubeConnection }) => {
  const user = await login()
  await insertYouTubeConnection(user.id) // Fixture cleans up automatically
})
```

## Fixture Implementation Details

### How Fixtures Work
1. **Setup**: Fixture creates data and tracks IDs
2. **Test Execution**: Test uses the created data
3. **Cleanup**: Fixture automatically deletes tracked data after test

### Adding New Fixtures
Follow the existing pattern in `tests/playwright-utils.ts`:

```typescript
newFixture: async ({}, use) => {
  const ids: string[] = []
  await use(async (options) => {
    const record = await prisma.model.create({ data: options })
    ids.push(record.id)
    return record
  })
  // Cleanup
  if (ids.length > 0) {
    try {
      await prisma.model.deleteMany({ where: { id: { in: ids } } })
    } catch (error) {
      console.warn(`Failed to cleanup:`, error)
    }
  }
}
```

## Test Categories

### UI Tests
- Test user interface behavior
- Use `login()` + `page.goto()` + assertions
- No complex data setup needed

### Integration Tests  
- Test API integration with external services
- Use `insertYouTubeConnection()` + server-side mocks
- Test complete user flows

### CRUD Tests
- Test create, read, update, delete operations
- Use appropriate fixtures (`insertNewTrack`, `insertNewPlaylist`)
- Test both success and error cases

## Debugging Tests

### Common Issues
1. **Test isolation failures**: Check for global cleanup or shared state
2. **Timing issues**: Use `page.waitFor()` or `expect().toBeVisible()`
3. **Data not found**: Verify fixtures are creating data correctly
4. **API mocking issues**: Check `MOCKS=true` and server-side mock implementation

### Debugging Tools
- `page.pause()` - Pause test execution for manual inspection
- `console.log()` in fixtures - Track data creation/cleanup
- Playwright Inspector - Visual debugging of test execution
