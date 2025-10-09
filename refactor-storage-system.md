# Refactor Storage System

## Overview

Rebuild `storage.server.ts` from scratch with a clean, unified architecture following Epic Stack patterns. Remove all backward compatibility - create a modern, consistent API for both image and audio storage with streaming support, leveraging Tigris object storage and TypeScript best practices.

## Architecture Principles

Based on Epic Stack patterns, this refactor follows these key principles:

- **Unified API**: Single interface for all file operations (images, audio, documents)
- **Type Safety**: Full TypeScript coverage with proper type definitions
- **Server-Side Utilities**: Leverage Epic Stack's server utility patterns
- **Environment Configuration**: Support for both production (Tigris) and development (mocked) environments
- **Performance**: Streaming support for large files with proper caching headers
- **Security**: Signed URLs with configurable expiration and proper access controls

## Implementation Steps

### 1. Environment Configuration

Following Epic Stack patterns, configure environment variables for both production and development:

```bash
# Production (Tigris)
AWS_ACCESS_KEY_ID="your-tigris-access-key"
AWS_SECRET_ACCESS_KEY="your-tigris-secret-key"
AWS_REGION="auto"
AWS_ENDPOINT_URL_S3="https://fly.storage.tigris.dev"
BUCKET_NAME="your-bucket-name"

# Development (mocked)
AWS_ACCESS_KEY_ID="mock-access-key"
AWS_SECRET_ACCESS_KEY="mock-secret-key"
AWS_REGION="auto"
AWS_ENDPOINT_URL_S3="https://fly.storage.tigris.dev"
BUCKET_NAME="mock-bucket"
```

### 2. Completely Rebuild `app/utils/storage.server.ts`

**New clean structure following Epic Stack patterns:**

```typescript
import { type Timings } from '#app/utils/timing.server.ts'
import { cachified, cache } from '#app/utils/cache.server.ts'

// Core AWS signature functions
- hmacSha256(), sha256(), getSignatureKey()

// Single unified signing function with caching support
- signRequest(params: {
    method: 'GET' | 'PUT' | 'DELETE'
    key: string
    contentType?: string
    metadata?: Record<string, string>
    expirySeconds?: number
    timings?: Timings
  }): { url: string; headers: Record<string, string> }

// Generic file operations (all use signRequest internally)
- uploadFile(params: {
    file: File | FileUpload | Buffer
    key: string
    contentType?: string
    metadata?: Record<string, string>
    timings?: Timings
  }): Promise<string>

- getFileUrl(key: string, expirySeconds?: number, timings?: Timings): { url: string; headers: Record<string, string> }

- deleteFile(key: string, timings?: Timings): Promise<void>

// Domain-specific wrappers with proper typing
- uploadProfileImage(userId: string, file: File | FileUpload, timings?: Timings): Promise<string>
- uploadAudioFile(buffer: Buffer, objectKey: string, metadata: Record<string, string>, timings?: Timings): Promise<string>
```

**Key changes:**

- Remove: `getSignedGetRequestInfo`, `getSignedAudioUrl`, `deleteAudioFile`, `getBaseSignedRequestInfo`, `getSignedPutRequestInfo`, `uploadToStorage`
- Single `signRequest()` handles all HTTP methods
- All functions use the same signing logic with Epic Stack's timing utilities
- Consistent parameter patterns with optional `timings` parameter
- Integration with Epic Stack's caching system for signed URL generation
- Proper TypeScript typing throughout

### 3. Add Helper Function to `app/utils/misc.tsx`

```typescript
export function getAudioSrc(objectKey?: string | null) {
  return objectKey
    ? `/resources/audio?objectKey=${encodeURIComponent(objectKey)}`
    : null
}
```

### 4. Update All Callers to Use New API

**Files to update:**

`app/routes/settings+/profile.photo.tsx` - Already uses `uploadProfileImage()` ✓

`app/routes/resources+/images.tsx`:

```typescript
// Change from:
const { url: signedUrl, headers: signedHeaders } = getSignedGetRequestInfo(objectKey)

// To:
const { url: signedUrl, headers: signedHeaders } = getFileUrl(objectKey, 3600, timings)
```

`app/routes/resources+/audio.tsx`:

```typescript
// Add Range request support and streaming
const { url: signedUrl, headers: signedHeaders } = getFileUrl(objectKey, 3600, timings)
// Pass through Range header, stream response
```

`app/routes/resources+/track.$trackId.download.tsx`:

```typescript
// Change from:
const downloadUrl = getSignedAudioUrl(track.audioFile.objectKey)

// To:
const { url: downloadUrl } = getFileUrl(track.audioFile.objectKey, 300, timings)
```

`app/utils/audio-archive.server.ts`:

```typescript
// uploadAudioToStorage() already calls uploadAudioFile() ✓
```

`app/utils/audio-queue.server.ts`:

```typescript
// Change from:
await deleteAudioFile(audioFile.objectKey)

// To:
await deleteFile(audioFile.objectKey, timings)
```

### 5. Update Audio Streaming Route

**File:** `app/routes/resources+/audio.tsx`

```typescript
import { makeTimings, time } from '#app/utils/timing.server.ts'
import { type Route } from './+types/audio.ts'

export async function loader({ request }: Route.LoaderArgs) {
  const timings = makeTimings('audio loader')
  
  const url = new URL(request.url)
  const objectKey = url.searchParams.get('objectKey')
  invariantResponse(objectKey, 'objectKey required', { status: 400 })
  
  // Time the signed URL generation
  const { url: signedUrl, headers: signedHeaders } = await time(
    () => getFileUrl(objectKey, 3600, timings),
    { timings, type: 'get signed url' }
  )
  
  // Support Range requests for seeking
  const rangeHeader = request.headers.get('Range')
  const fetchHeaders = { ...signedHeaders }
  if (rangeHeader) {
    fetchHeaders['Range'] = rangeHeader
  }
  
  // Time the external fetch
  const response = await time(
    () => fetch(signedUrl, { headers: fetchHeaders }),
    { timings, type: 'fetch audio' }
  )
  
  if (!response.ok) {
    throw new Response('Audio not found', { status: 404 })
  }
  
  // Stream response (don't buffer) with proper caching headers
  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Length': response.headers.get('Content-Length') || '',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable', // Epic Stack pattern
      'Server-Timing': timings.toString(),
      ...(response.status === 206 && {
        'Content-Range': response.headers.get('Content-Range') || '',
      }),
    },
  })
}
```

### 6. Add Audio Players to UI

**File:** `app/routes/library.$trackId.tsx`

```tsx
{track.audioFile?.objectKey && track.audioFile.status === 'completed' && (
  <div>
    <h3 className="text-lg font-semibold mb-4">Audio Playback</h3>
    <div className="space-y-4">
      <audio 
        src={getAudioSrc(track.audioFile.objectKey)}
        controls
        preload="metadata"
        className="w-full"
      >
        Your browser does not support audio playback.
      </audio>
      
      <div className="flex gap-2">
        <Button asChild>
          <Link to={`/resources/track/${track.id}/download`}>
            <Icon name="download" className="mr-2" />
            Download MP3
          </Link>
        </Button>
      </div>
    </div>
  </div>
)}
```

## Database Schema Updates

Following Epic Stack patterns, ensure your Prisma schema includes proper metadata storage:

```prisma
model AudioFile {
  id          String   @id @default(cuid())
  trackId     String
  track       Track    @relation(fields: [trackId], references: [id], onDelete: Cascade)
  objectKey   String   // Reference to the audio file in Tigris
  status      String   // 'processing', 'completed', 'failed'
  metadata    Json?    // Store additional metadata
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index ([trackId])
  @@index ([status])
}
```

## Deployment Considerations

### Tigris Storage Setup

Create Tigris object storage buckets for production and staging:

```bash
# Create storage buckets
fly storage create --app [YOUR_APP_NAME]
fly storage create --app [YOUR_APP_NAME]-staging
```

### Environment Variables

Ensure all required environment variables are set in your Fly.io apps:

```bash
# Set environment variables
fly secrets set AWS_ACCESS_KEY_ID="your-key" --app [YOUR_APP_NAME]
fly secrets set AWS_SECRET_ACCESS_KEY="your-secret" --app [YOUR_APP_NAME]
fly secrets set BUCKET_NAME="your-bucket" --app [YOUR_APP_NAME]
```

### Content Security Policy

Update your CSP to allow audio sources if needed:

```typescript
// In your CSP configuration
contentSecurityPolicy: {
  directives: {
    'media-src': ["'self'", 'https://*.tigris.dev'], // Allow audio from Tigris
    // ... other directives
  }
}
```

## Files Changed

1. `app/utils/storage.server.ts` - Complete rebuild with unified API and Epic Stack patterns
2. `app/utils/misc.tsx` - Add `getAudioSrc()` helper
3. `app/routes/resources+/images.tsx` - Use `getFileUrl()` with timing support
4. `app/routes/resources+/audio.tsx` - Add streaming with Range requests and server timing
5. `app/routes/resources+/track.$trackId.download.tsx` - Use `getFileUrl()` with timing support
6. `app/utils/audio-queue.server.ts` - Use `deleteFile()` with timing support
7. `app/routes/library.$trackId.tsx` - Add audio player
8. `prisma/schema.prisma` - Update AudioFile model with proper indexing

## Key Benefits

- **Clean, unified API**: No legacy functions, single interface for all file operations
- **Epic Stack integration**: Leverages timing utilities, caching, and TypeScript patterns
- **Performance optimized**: Server timing, caching, and streaming support
- **Type safety**: Full TypeScript coverage with proper type definitions
- **Environment flexibility**: Works with both production (Tigris) and development (mocked) environments
- **Audio streaming**: Range request support for seeking in audio files
- **Proper caching**: Immutable cache headers following Epic Stack patterns
- **Database integration**: Proper Prisma schema with indexing for performance
- **Deployment ready**: Complete Fly.io and Tigris configuration guidance
- **Security**: Signed URLs with configurable expiration and proper access controls

## Testing and Monitoring

### Server Timing Integration

All storage operations include server timing for performance monitoring:

```typescript
// Example usage in a loader
export async function loader({ request }: Route.LoaderArgs) {
  const timings = makeTimings('storage operations')
  
  const result = await time(
    () => uploadFile({ file, key, timings }),
    { timings, type: 'upload file' }
  )
  
  return json(result, {
    headers: { 'Server-Timing': timings.toString() }
  })
}
```

### Caching Strategy

Leverage Epic Stack's caching system for signed URL generation:

```typescript
// Cache signed URLs to reduce computation
const signedUrl = await cachified({
  key: `signed-url:${objectKey}:${expirySeconds}`,
  cache,
  timings,
  getFreshValue: () => signRequest({ method: 'GET', key: objectKey, expirySeconds }),
  ttl: 1000 * 60 * 5, // 5 minutes
  staleWhileRevalidate: 1000 * 60 * 10, // 10 minutes
})
```

### Error Handling

Implement proper error handling following Epic Stack patterns:

```typescript
// In storage operations
try {
  const result = await uploadFile(params)
  return result
} catch (error) {
  console.error('Storage operation failed:', error)
  throw new Response('Storage operation failed', { status: 500 })
}
```

## Development Approach

Since we're in development, we can take a direct approach:

1. **Replace existing system**: Completely rebuild `storage.server.ts` with the new unified API
2. **Update all callers**: Modify all files to use the new functions
3. **Test thoroughly**: Ensure all functionality works with the new system
4. **Clean up**: Remove any unused legacy code

This direct approach is perfect for development where we can afford to break things temporarily while we build the new system.

## Tigris Storage Integration

### Tigris-Specific Features

Tigris provides S3-compatible object storage with additional benefits:

- **Global Distribution**: Built-in CDN with low-latency access worldwide
- **Dynamic Data Placement**: Automatic optimization based on access patterns
- **S3 API Compatibility**: Drop-in replacement for AWS S3
- **Fly.io Integration**: Seamless deployment with automatic environment setup

### Tigris Configuration

```typescript
// Tigris-specific configuration
const tigrisConfig = {
  endpoint: process.env.AWS_ENDPOINT_URL_S3, // https://fly.storage.tigris.dev
  region: process.env.AWS_REGION, // "auto" for Tigris
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  // Tigris-specific options
  forcePathStyle: true, // Required for Tigris
  signatureVersion: 'v4',
}
```

### Local Development with Tigris Mock

For local development, Tigris provides a mock service:

```bash
# Local development environment
AWS_ACCESS_KEY_ID="mock-access-key"
AWS_SECRET_ACCESS_KEY="mock-secret-key"
AWS_REGION="auto"
AWS_ENDPOINT_URL_S3="https://fly.storage.tigris.dev"
BUCKET_NAME="mock-bucket"
```

## AWS SDK v3 Integration

### Modern AWS SDK Patterns

Using AWS SDK v3 with TypeScript for better performance and tree-shaking:

```typescript
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  endpoint: process.env.AWS_ENDPOINT_URL_S3,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

// Generate presigned URL with custom headers
export async function generatePresignedUrl(
  key: string,
  operation: 'GET' | 'PUT' = 'GET',
  options: {
    expiresIn?: number
    contentType?: string
    metadata?: Record<string, string>
  } = {}
) {
  const command = operation === 'GET' 
    ? new GetObjectCommand({ Bucket: process.env.BUCKET_NAME, Key: key })
    : new PutObjectCommand({ 
        Bucket: process.env.BUCKET_NAME, 
        Key: key,
        ContentType: options.contentType,
        Metadata: options.metadata,
      })

  return getSignedUrl(s3Client, command, {
    expiresIn: options.expiresIn || 3600,
    signableHeaders: new Set(['content-type']),
  })
}
```

### Streaming with AWS SDK v3

```typescript
import { Readable } from 'stream'

// Stream file upload
export async function streamUpload(
  key: string,
  stream: Readable,
  contentType: string,
  metadata?: Record<string, string>
) {
  const command = new PutObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: key,
    Body: stream,
    ContentType: contentType,
    Metadata: metadata,
  })

  return s3Client.send(command)
}

// Stream file download
export async function streamDownload(key: string): Promise<Readable> {
  const command = new GetObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: key,
  })

  const response = await s3Client.send(command)
  return response.Body as Readable
}
```

## Node.js Streaming Best Practices

### Efficient Response Streaming

Following Node.js streaming patterns for optimal performance:

```typescript
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'

// Stream response without buffering
export async function streamResponse(
  request: Request,
  objectKey: string
): Promise<Response> {
  const { url: signedUrl, headers: signedHeaders } = getFileUrl(objectKey)
  
  // Support Range requests for audio seeking
  const rangeHeader = request.headers.get('Range')
  const fetchHeaders = { ...signedHeaders }
  if (rangeHeader) {
    fetchHeaders['Range'] = rangeHeader
  }

  try {
    const response = await fetch(signedUrl, { headers: fetchHeaders })
    
    if (!response.ok) {
      throw new Response('File not found', { status: 404 })
    }

    // Stream the response body directly
    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
        'Content-Length': response.headers.get('Content-Length') || '',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000, immutable',
        ...(response.status === 206 && {
          'Content-Range': response.headers.get('Content-Range') || '',
        }),
      },
    })
  } catch (error) {
    console.error('Streaming error:', error)
    throw new Response('Streaming failed', { status: 500 })
  }
}
```

### Error Handling in Streams

```typescript
// Proper error handling for streaming operations
export async function handleStreamError(
  stream: Readable,
  errorHandler: (error: Error) => void
) {
  stream.on('error', (error) => {
    console.error('Stream error:', error)
    errorHandler(error)
  })

  stream.on('end', () => {
    console.log('Stream ended successfully')
  })
}
```

## Performance Optimization

### Caching Strategy

Implement multi-level caching for optimal performance:

```typescript
// Cache signed URLs to reduce computation
const signedUrlCache = new Map<string, { url: string; expires: number }>()

export async function getCachedSignedUrl(
  key: string,
  operation: 'GET' | 'PUT' = 'GET',
  expiresIn: number = 3600
): Promise<string> {
  const cacheKey = `${operation}:${key}:${expiresIn}`
  const cached = signedUrlCache.get(cacheKey)
  
  if (cached && cached.expires > Date.now()) {
    return cached.url
  }

  const url = await generatePresignedUrl(key, operation, { expiresIn })
  
  signedUrlCache.set(cacheKey, {
    url,
    expires: Date.now() + (expiresIn * 1000),
  })

  return url
}
```

### Connection Pooling

```typescript
// Reuse S3 client for connection pooling
let s3ClientInstance: S3Client | null = null

export function getS3Client(): S3Client {
  if (!s3ClientInstance) {
    s3ClientInstance = new S3Client({
      region: process.env.AWS_REGION,
      endpoint: process.env.AWS_ENDPOINT_URL_S3,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
      maxAttempts: 3,
      retryMode: 'adaptive',
    })
  }
  
  return s3ClientInstance
}
```