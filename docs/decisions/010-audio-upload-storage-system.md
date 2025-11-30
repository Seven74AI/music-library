# ADR-010: Audio File Upload and Storage System

## Status
Accepted

## Context

The Music Library application needs a robust system for users to upload their own audio files. The system must handle:

1. **Multiple upload formats**: Individual audio files and ZIP archives containing multiple files
2. **Large file sizes**: Audio files can be 50-100MB+, ZIP archives up to 500MB
3. **Real-time progress**: Users need visibility into upload progress, especially on slow networks (3G)
4. **Metadata extraction**: Extract track information (title, artist, album, etc.) from audio files
5. **Storage integration**: Upload to S3-compatible storage (Tigris) with progress tracking
6. **Error handling**: Graceful handling of failures with clear error messages
7. **Performance**: Parallel processing to speed up batch uploads

### Previous Limitations

- No user upload capability (only YouTube sync)
- No progress tracking for long-running operations
- No metadata extraction from audio files
- No ZIP file support

## Decision

We implemented a multi-phase upload system with:

1. **Three-Phase Upload Architecture**:
   - Phase 1: Browser → Server (tracked via XMLHttpRequest)
   - Phase 2: Server-side metadata extraction (tracked via SSE)
   - Phase 3: Server → Storage (tracked via SSE with S3 progress events)

2. **ZIP File Support**: Extract audio files from ZIP archives with intelligent filtering

3. **Metadata Extraction**: Use `music-metadata` library to extract track information

4. **Storage Strategy**: Size-based upload strategies for S3/Tigris compatibility

5. **Real-time Progress**: Server-Sent Events (SSE) for live progress updates

6. **Concurrency Control**: Process up to 5 files in parallel for optimal performance

## Implementation Details

### Multi-Phase Upload Flow

```
┌─────────┐     Phase 1      ┌─────────┐     Phase 2      ┌─────────┐     Phase 3      ┌─────────┐
│ Browser │ ───────────────> │ Server │ ───────────────> │ Storage │ ───────────────> │ Database│
│         │  (XMLHttpRequest)│         │  (Metadata Ext.)│  (S3)   │  (Prisma)       │         │
└─────────┘                  └─────────┘                  └─────────┘                  └─────────┘
     │                             │                             │                         │
     └─ Progress: 0-100%           └─ Progress: 0-50%            └─ Progress: 50-95%       └─ Progress: 95-100%
```

#### Phase 1: Browser → Server
- **Technology**: XMLHttpRequest (for upload progress tracking)
- **Progress Tracking**: `xhr.upload.onprogress` events
- **UI Display**: "Uploading to server..." with progress bar
- **Purpose**: Transfer files from user's browser to server

#### Phase 2: Server-side Processing
- **Sub-phases**:
  1. **Metadata Extraction** (0-10%): Extract audio metadata from files
  2. **ID Generation** (10%): Generate track, artist, album IDs
  3. **File Upload to Storage** (10-50%): Upload files to S3/Tigris
  4. **Database Operations** (50-100%): Create database records

#### Phase 3: Server → Storage
- **Technology**: AWS SDK `Upload` class with `httpUploadProgress` events
- **Progress Mapping**: S3 upload progress (0-100%) mapped to overall file progress (10-50%)
- **UI Display**: "Uploading files to storage..." with individual file progress

### ZIP File Extraction

#### Filtering Strategy

1. **Directory Filtering**: Skip all directory entries
2. **macOS Metadata Filtering**: 
   - Skip files in `__MACOSX/` directories
   - Skip files with basename starting with `._` (macOS resource fork files)
   - Note: Only check basename, not full path, to avoid filtering legitimate files with underscores
3. **Audio Format Filtering**: Only process files with supported audio extensions:
   - `mp3`, `flac`, `wav`, `m4a`, `aac`, `ogg`, `opus`, `webm`
4. **Size Filtering**: Skip files smaller than 1KB (likely corrupted or metadata files)

#### Extraction Process

```typescript
for (const entry of zip.getEntries()) {
  // Skip directories
  if (entry.isDirectory) continue
  
  // Skip macOS metadata
  const basename = entry.entryName.split('/').pop() || entry.entryName
  if (entry.entryName.includes('__MACOSX/') || basename.startsWith('._')) {
    continue
  }
  
  // Check audio format
  if (!isAudioFile(entry.entryName)) continue
  
  // Extract and validate size
  const buffer = entry.getData()
  if (buffer.length < 1024) continue // Skip small files
  
  audioFiles.push({ fileName: entry.entryName, buffer })
}
```

### Metadata Extraction

#### Library: `music-metadata`

- **Function**: `parseBuffer(buffer)` - Extracts metadata from audio file buffers
- **Supported Formats**: MP3, FLAC, WAV, M4A, AAC, OGG, OPUS, WebM
- **Extracted Fields**:
  - Basic: title, artist, album, albumArtist, genre, year, date
  - Track info: track number, disk number, duration
  - Audio properties: bitrate, sampleRate, format, mimeType, lossless
  - Extended: BPM, label, ISRC, lyrics, cover image

#### Fallback Strategy

If metadata extraction fails:
1. Log error with file details (name, size, error object)
2. Fall back to format detection from filename
3. Return minimal metadata (format, mimeType) to allow upload to proceed

#### Error Handling

```typescript
try {
  const metadata = await parseBuffer(buffer)
  // Extract metadata...
} catch (error) {
  console.error('Error extracting audio metadata:', {
    fileName,
    fileSize: buffer.length,
    error: error instanceof Error ? {
      message: error.message,
      stack: error.stack,
      name: error.name,
    } : error,
  })
  // Fallback to format detection
  const format = getFormatFromFileName(fileName)
  return { format, mimeType: getMimeTypeFromFormat(format) }
}
```

### Storage System Architecture

#### S3/Tigris Integration

- **Client**: AWS SDK `S3Client` with Tigris endpoint configuration
- **Compatibility**: S3-compatible API (works with Tigris, AWS S3, MinIO, etc.)
- **Configuration**: Environment variables:
  - `AWS_ENDPOINT_URL_S3`: Storage endpoint URL
  - `BUCKET_NAME`: Bucket name
  - `AWS_ACCESS_KEY_ID`: Access key
  - `AWS_SECRET_ACCESS_KEY`: Secret key
  - `AWS_REGION`: Region

#### Size-Based Upload Strategies

The system uses different upload strategies based on file size to optimize for Tigris compatibility and performance:

1. **Small Files (< 5MB)**:
   - **Strategy**: `PutObjectCommand` (single-part upload)
   - **Reason**: Avoids `Upload` class validation error for files smaller than 5MB (Tigris multipart minimum)
   - **Progress**: Simulated (0% → 100%) since PutObjectCommand doesn't support progress events
   - **Use Case**: Cover images, small audio files

2. **Medium Files (5MB - 100MB)**:
   - **Strategy**: `Upload` class with `partSize > fileSize` (forces single-part)
   - **Progress**: Real-time via `httpUploadProgress` events
   - **Use Case**: Most audio files

3. **Large Files (> 100MB)**:
   - **Strategy**: `Upload` class with multipart upload (50MB parts)
   - **Progress**: Real-time via `httpUploadProgress` events
   - **Concurrency**: 4 concurrent parts (`queueSize: 4`)
   - **Use Case**: Large audio files, high-quality FLAC files

#### Error Categorization

Storage errors are categorized for better error handling:

- `STORAGE_ERROR`: Generic storage error
- `STORAGE_ACCESS_DENIED`: 403 errors, permission issues
- `STORAGE_BUCKET_NOT_FOUND`: 404 errors, bucket doesn't exist
- `STORAGE_NETWORK_ERROR`: Timeout, connection reset
- `STORAGE_AUTH_ERROR`: Invalid credentials, signature mismatch

```typescript
function handleStorageError(error: unknown, key: string, config: StorageConfig, fileSize: number): never {
  const errorMessage = error instanceof Error ? error.message : String(error)
  
  // Categorize error
  let errorType = 'STORAGE_ERROR'
  if (errorMessage.includes('AccessDenied') || errorMessage.includes('403')) {
    errorType = 'STORAGE_ACCESS_DENIED'
  } else if (errorMessage.includes('NoSuchBucket') || errorMessage.includes('404')) {
    errorType = 'STORAGE_BUCKET_NOT_FOUND'
  } else if (errorMessage.includes('timeout') || errorMessage.includes('ECONNRESET')) {
    errorType = 'STORAGE_NETWORK_ERROR'
  } else if (errorMessage.includes('InvalidAccessKeyId') || errorMessage.includes('SignatureDoesNotMatch')) {
    errorType = 'STORAGE_AUTH_ERROR'
  }
  
  throw new Error(`${errorType}: Failed to upload object: ${key} - ${errorMessage}`)
}
```

### Progress Tracking System

#### Server-Sent Events (SSE)

- **Endpoint**: `GET /api/upload-progress/:uploadId`
- **Protocol**: Server-Sent Events for real-time updates
- **Update Frequency**: Immediate (no throttling, updates pushed as they occur)
- **Connection Management**: Multiple clients can connect to same upload session

#### Progress Data Structure

```typescript
{
  type: 'progress',
  files: Array<{
    fileId: string
    fileName: string
    progress: number // 0-100
    status: 'pending' | 'processing' | 'uploading' | 'completed' | 'failed'
    error?: string
  }>,
  overallProgress: number // 0-100, average of all files
  status: 'active' | 'completed' | 'failed'
  uploadSpeed: number // bytes per second
  successfulTracks: Array<{ trackId, fileName, title, artist }>
  failedFiles: Array<{ fileId, fileName, error }>
}
```

#### Progress Milestones

For each file:
- **0%**: Initial state
- **5%**: Validation complete
- **10%**: IDs generated, starting upload
- **10-50%**: S3 upload progress (mapped from S3 progress events)
- **50%**: Upload complete
- **60%**: Artist/Album created
- **75%**: Track created
- **85%**: Audio file record created
- **95%**: User track created
- **100%**: Complete

#### Upload Speed Calculation

```typescript
const elapsedSeconds = (Date.now() - progress.startTime) / 1000
const totalBytes = progress.files.reduce((sum, file) => {
  if (file.fileSize && file.status !== 'pending' && file.status !== 'processing') {
    return sum + (file.fileSize * file.progress / 100)
  }
  return sum
}, 0)
const uploadSpeed = totalBytes / elapsedSeconds // bytes/second
```

### Concurrency Control

#### Parallel Processing

- **Metadata Extraction**: Up to 5 files processed in parallel
- **File Upload**: Up to 5 files uploaded in parallel
- **Database Operations**: Within each file's transaction (sequential per file)

#### Implementation

```typescript
async function processWithConcurrency<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  concurrency: number = 5
): Promise<R[]> {
  const results: R[] = []
  
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map((item, batchIndex) => processor(item, i + batchIndex))
    )
    results.push(...batchResults)
  }
  
  return results
}
```

### Database Operations

#### Transaction Strategy

- **Timeout**: 30 seconds (increased from 5s to accommodate image processing and uploads)
- **Max Wait**: 10 seconds
- **Scope**: Each file processed in its own transaction
- **Operations** (in order):
  1. Create/Find Artist
  2. Create/Find Album
  3. Create/Find Cover Image (with image processing)
  4. Create Track
  5. Create AudioFile record
  6. Create UserTrack record

#### Error Handling

- Failed files are tracked in `failedFiles` array
- Successful tracks are tracked in `successfulTracks` array
- Partial failures don't block other files
- All operations within a file are atomic (transaction)

## Alternatives Considered

### 1. Single-Phase Upload (No Progress Tracking)
**Pros**: Simpler implementation
**Cons**: Poor UX on slow networks, no visibility into progress
**Decision**: Multi-phase provides better user experience

### 2. Polling for Progress Updates
**Pros**: Simpler server implementation
**Cons**: Higher server load, delayed updates, inefficient
**Decision**: SSE provides real-time updates with lower overhead

### 3. Sequential File Processing
**Pros**: Simpler concurrency management
**Cons**: Much slower for batch uploads
**Decision**: Parallel processing with concurrency limit provides optimal balance

### 4. Single Transaction for All Files
**Pros**: Atomic batch operation
**Cons**: Very long transaction time, high risk of timeout, blocks all files on single failure
**Decision**: Per-file transactions provide better reliability and performance

### 5. Client-Side Metadata Extraction
**Pros**: Reduces server load
**Cons**: Browser compatibility issues, larger client bundle, inconsistent results
**Decision**: Server-side extraction provides consistent, reliable results

### 6. Multipart Upload for All Files
**Pros**: Consistent upload strategy
**Cons**: Tigris compatibility issues for small files (< 5MB minimum part size)
**Decision**: Size-based strategy provides best compatibility and performance

## Consequences

### Positive

- ✅ **Excellent UX**: Real-time progress updates on all upload phases
- ✅ **Fast Batch Uploads**: Parallel processing (5 files) significantly speeds up uploads
- ✅ **Robust Error Handling**: Categorized errors with clear messages
- ✅ **ZIP Support**: Users can upload entire albums in one ZIP file
- ✅ **Rich Metadata**: Automatic extraction of track information
- ✅ **Storage Flexibility**: Works with any S3-compatible storage
- ✅ **Performance Optimized**: Size-based upload strategies for optimal performance
- ✅ **Network Resilient**: Works well on slow networks (3G) with clear progress feedback

### Negative

- ⚠️ **Complexity**: Multi-phase system requires careful state management
- ⚠️ **Memory Usage**: Files loaded into memory during processing (acceptable for audio file sizes)
- ⚠️ **SSE Connections**: Multiple connections per upload session (acceptable for typical use)
- ⚠️ **Transaction Timeouts**: 30-second timeout may still be insufficient for very large files
- ⚠️ **Progress Store**: In-memory store (should use Redis in production for scalability)

### Trade-offs

- **Progress Granularity vs. Performance**: Fine-grained progress updates provide better UX but require more frequent updates
- **Concurrency vs. Resource Usage**: 5 concurrent files balances speed and server resources
- **Transaction Scope**: Per-file transactions provide better reliability but don't guarantee atomic batch operations
- **Storage Strategy**: Size-based strategies optimize for Tigris compatibility but add complexity

## Testing

### Unit Tests
- ZIP extraction with various file structures
- Metadata extraction with different audio formats
- Error handling for corrupted files
- Storage error categorization

### Integration Tests
- End-to-end upload flow (browser → server → storage → database)
- Progress tracking accuracy
- Concurrent upload handling
- Error recovery

### E2E Tests
- User upload flow with progress display
- ZIP file upload and extraction
- Error scenarios (network failures, invalid files)
- Progress updates on slow networks

## Production Considerations

### Scalability

1. **Progress Store**: Replace in-memory `Map` with Redis for multi-server deployments
2. **File Processing**: Consider queue system (Bull, BullMQ) for very large batches
3. **Storage**: Monitor S3/Tigris rate limits and implement backoff strategies
4. **Database**: Monitor transaction timeouts and adjust as needed

### Monitoring

- Upload success/failure rates
- Average upload time per file
- Storage error rates by category
- Metadata extraction success rate
- Progress update frequency

### Error Recovery

- Failed files stored in `failedFiles` with file data for retry
- User can retry failed uploads
- Clear error messages guide user actions

## References

- Implementation: `app/routes/api+/upload-audio-batch.tsx`
- Progress Tracking: `app/routes/api+/upload-progress.$uploadId.tsx`
- Storage: `app/utils/storage.server.ts`
- ZIP Extraction: `app/utils/zip-extraction.server.ts`
- Metadata Extraction: `app/utils/audio-metadata.server.ts`
- [AWS SDK Upload Documentation](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-s3/modules/lib-storage.html)
- [music-metadata Documentation](https://github.com/Borewit/music-metadata)
- [Server-Sent Events (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
- [adm-zip Documentation](https://github.com/cthackers/adm-zip)

