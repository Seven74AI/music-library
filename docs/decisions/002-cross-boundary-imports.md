# ADR-002: Eliminating Cross-Boundary Imports Between App and Server Layers

## Status
Accepted

## Context
The Music Library application has a hybrid architecture with two distinct layers:
- **React Router Layer** (`app/`): Handles web requests, UI, and user interactions
- **Express Server Layer** (`server/`): Handles background workers and background processing

During development, we encountered cross-boundary import issues where the admin UI was importing functions directly from server workers, creating architectural coupling and build complexity.

### Problems with Cross-Boundary Imports

#### 1. Admin UI Importing from Server Workers
```typescript
// app/routes/admin+/audio-queue.tsx
import { getQueueStats, getTracksForAdmin, enqueueTrack } from '#server/workers/audio-queue'
import { pauseWorker, resumeWorker, getWorkerStatus } from '#server/workers/audio-worker-control'
```

#### 2. Server Workers Importing from App Utils
```typescript
// server/workers/audio-queue.ts
import { prisma } from '#app/utils/db.server'
import { uploadAudioFile } from '#app/utils/storage.server'
```

#### 3. Build System Complexity
- React Router build (`build:remix`) needed to access server code
- Express build (`build:server`) needed to access app code
- Path alias resolution across different build systems
- Module resolution errors in production

#### 4. Architectural Violations
- Tight coupling between layers
- Violation of separation of concerns
- Difficult to scale or split services later
- Mixed responsibilities in single functions

### Requirements
- Clean architectural separation between app and server layers
- Zero cross-boundary imports
- Maintainable and scalable architecture
- Fast build times
- Clear communication patterns between layers

## Decision
Implement **Option 4: Database State Communication** - Use the database as the communication layer between app and server components.

### Architecture Pattern

#### Database as Communication Layer
```
Admin UI                    Database                    Worker
   ↓                           ↓                           ↓
Write state          ←→   Shared tables   ←→      Read/process state
```

#### Key Principles
1. **Database is Single Source of Truth**: All state changes go through database
2. **Eventually Consistent**: Components communicate through database state
3. **No Direct Function Calls**: No imports between app and server layers
4. **Event-Driven**: Changes propagate through database state changes

### Implementation Strategy

#### 1. Admin UI Operations
Replace function calls with direct database operations:

**Before:**
```typescript
const result = await pauseWorker()
```

**After:**
```typescript
await prisma.workerState.update({
  where: { id: 'singleton' },
  data: { status: 'paused', lastStateChange: new Date() },
})
return data({ success: true, message: 'Worker pause requested (will take effect in ~5 min)' })
```

#### 2. Worker State Reading
Workers check database state on each loop:

```typescript
// server/workers/audio-worker.ts
const workerState = await prisma.workerState.findUnique({
  where: { id: 'singleton' },
})

if (workerState.status === 'running') {
  await processQueue()
} else {
  console.log(`Worker status is ${workerState.status}, skipping queue processing`)
}
```

#### 3. Efficient Data Queries
Use optimized database queries instead of function wrappers:

**Before:**
```typescript
const [stats, tracks, workerStatus] = await Promise.all([
  getQueueStats(),           // 5 separate count queries
  getTracksForAdmin({ ... }), // Function wrapper
  getWorkerStatus(),          // Function wrapper
])
```

**After:**
```typescript
const [statsGrouped, tracks, workerState] = await Promise.all([
  prisma.trackAudioFile.groupBy({ by: ['status'], _count: { _all: true } }), // 1 grouped query
  prisma.trackAudioFile.findMany({ ... }), // Direct query
  prisma.workerState.findUnique({ where: { id: 'singleton' } }), // Direct query
])
```

## Consequences

### Positive
- ✅ **Zero Cross-Boundary Imports**: Complete architectural separation
- ✅ **Faster Page Loads**: 4 queries instead of 8 (groupBy vs separate counts)
- ✅ **Instant UI Feedback**: Actions return immediately
- ✅ **Scalable Architecture**: Can move worker to separate service
- ✅ **Resilient Components**: App and server can fail independently
- ✅ **Auditable Operations**: All changes logged in database
- ✅ **Simpler Builds**: No complex path resolution between layers
- ✅ **Better Performance**: More efficient SQL queries

### Negative
- ⚠️ **Eventually Consistent**: Worker changes take ~5 minutes to propagate
- ⚠️ **No Graceful Shutdown**: Worker doesn't wait for current downloads to finish
- ⚠️ **Some Query Duplication**: Similar Prisma queries in different places
- ⚠️ **Inline Helper Functions**: Small utility functions need to be inline

### Neutral
- 🔄 **Different Communication Pattern**: Event-driven vs direct function calls
- 🔄 **Database Schema Coupling**: Components coupled through database schema
- 🔄 **State Management**: Database becomes the state management layer

## Implementation Details

### File Structure Changes
```
app/routes/admin+/audio-queue.tsx
├── Direct Prisma queries (no server imports)
├── Inline helper functions
└── Database state updates

server/workers/
├── audio-worker.ts (reads database state)
├── audio-queue.ts (self-contained)
└── audio-worker-control.ts (self-contained)

server/utils/
├── db.ts (simple Prisma client)
└── storage.ts (minimal storage functions)
```

### Key Patterns

#### Admin UI Loader Pattern
```typescript
export async function loader({ request }) {
  // Direct Prisma queries - no cross-boundary imports
  const [statsGrouped, tracks, workerState] = await Promise.all([
    prisma.trackAudioFile.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.trackAudioFile.findMany({ include: { track: true } }),
    prisma.workerState.findUnique({ where: { id: 'singleton' } }),
  ])
  
  return data({ statsGrouped, tracks, workerState })
}
```

#### Admin UI Action Pattern
```typescript
export async function action({ request }) {
  const intent = formData.get('intent')
  
  switch (intent) {
    case 'pause-worker':
      // Direct database write
      await prisma.workerState.update({
        where: { id: 'singleton' },
        data: { status: 'paused', lastStateChange: new Date() },
      })
      return data({ success: true, message: 'Worker pause requested' })
  }
}
```

#### Worker State Check Pattern
```typescript
async function workerLoop() {
  // Read state from database
  const workerState = await prisma.workerState.findUnique({
    where: { id: 'singleton' },
  })
  
  // Respect database state
  if (workerState.status === 'paused') {
    console.log('Worker paused by admin')
    return
  }
  
  // Process queue
  await processQueue()
}
```

### Helper Functions
Small utility functions are kept inline to avoid cross-boundary imports:

```typescript
// Inline helper functions
function calculateNextLongBreak(): Date {
  const hours = 6 + Math.random() * 2 // Random 6-8 hours
  return new Date(Date.now() + hours * 60 * 60 * 1000)
}

function formatWorkerStatus(workerState: any) {
  // Format worker state for UI display
  // ...
}
```

## Alternatives Considered

### Alternative 1: Shared Utils Folder
- **Pros**: DRY principle, shared types, immediate execution
- **Cons**: Build coupling, configuration complexity, shared code maintenance
- **Decision**: Rejected - adds build complexity and coupling

### Alternative 2: API Endpoints
- **Pros**: True separation, RESTful, scalable
- **Cons**: HTTP overhead, more code, complexity
- **Decision**: Rejected - overkill for current needs

### Alternative 3: Duplicate Functions
- **Pros**: No cross-boundary imports, simple
- **Cons**: Code duplication, maintenance burden, drift risk
- **Decision**: Rejected - violates DRY principle

### Alternative 4: Event-Driven Architecture
- **Pros**: Decoupled, scalable, real-time
- **Cons**: Infrastructure complexity, debugging difficulty
- **Decision**: Rejected - too complex for current needs

### Alternative 5: Hybrid Approach
- **Pros**: Best of both worlds
- **Cons**: Still has some cross-boundary imports
- **Decision**: Rejected - doesn't achieve complete separation

## Migration Strategy

### Phase 1: Server Layer Isolation
1. Move worker files from `app/utils/` to `server/workers/`
2. Create `server/utils/db.ts` and `server/utils/storage.ts`
3. Update server imports to use relative paths
4. Test server build and startup

### Phase 2: Admin UI Refactoring
1. Replace function calls with direct Prisma queries
2. Add inline helper functions
3. Update loader and action functions
4. Remove cross-boundary imports

### Phase 3: Service Utilities
1. Update `service-import.server.ts` and `service-playlist.server.ts`
2. Replace `enqueueTrack()` calls with database upsert logic
3. Test all functionality

### Phase 4: Verification
1. Verify no cross-boundary imports remain
2. Test build and startup
3. Test admin UI functionality
4. Document new patterns

## Success Metrics

### Technical Metrics
- [x] Zero cross-boundary imports between app and server
- [x] Build succeeds for both React Router and Express
- [x] Server starts and worker initializes
- [x] Admin UI functions work with database operations
- [x] Page loads are faster (4 queries vs 8)

### Quality Metrics
- [x] Clean architectural separation
- [x] Database is single source of truth
- [x] Components can fail independently
- [x] All operations are auditable
- [x] Code is maintainable and scalable

### Developer Experience Metrics
- [x] Clear communication patterns
- [x] Easy to understand architecture
- [x] Simple to add new features
- [x] Fast build times
- [x] Good error messages

## Future Considerations

### Scalability
- Worker can be moved to separate service
- Database can be split if needed
- Easy to add new communication patterns
- Supports microservices architecture

### Performance
- Database queries are optimized
- No HTTP overhead for internal communication
- Efficient state management
- Fast UI responses

### Maintenance
- Clear separation of concerns
- Easy to debug and test
- Simple to extend functionality
- Well-documented patterns

## References

- [React Router Documentation](https://reactrouter.com/)
- [Express.js Documentation](https://expressjs.com/)
- [Prisma Documentation](https://www.prisma.io/docs/)
- [Database as Communication Layer Pattern](https://microservices.io/patterns/data/database-per-service.html)

## Related ADRs

- [ADR-001: Type Safety with Zod Validation](./001-type-safety-architecture.md)

## Revision History

- **2024-12-XX**: Initial version
- **2024-12-XX**: Added implementation details and migration strategy
