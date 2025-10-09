// @context7: @epic-web/invariant, Fetch API, React, AWS S3
import { invariantResponse } from '@epic-web/invariant'
import { getFileUrl } from '#app/utils/storage.server.ts'
import { makeTimings, time } from '#app/utils/timing.server.ts'
import { type Route } from './+types/audio'

// Constants
const DEFAULT_CACHE_MAX_AGE = 31536000 // 1 year
const DEFAULT_SIGNED_URL_EXPIRY = 3600 // 1 hour

/**
 * Create audio response with proper headers
 */
function createAudioResponse(
  response: Response,
  timings: ReturnType<typeof makeTimings>
): Response {
  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Length': response.headers.get('Content-Length') || '',
      'Accept-Ranges': 'bytes',
      'Cache-Control': `public, max-age=${DEFAULT_CACHE_MAX_AGE}, immutable`,
      'Server-Timing': timings.toString(),
      ...(response.status === 206 && {
        'Content-Range': response.headers.get('Content-Range') || '',
      }),
    },
  })
}

/**
 * Fetch audio from mock storage
 */
async function fetchFromMockStorage(
  objectKey: string,
  rangeHeader: string | null,
  timings: ReturnType<typeof makeTimings>
): Promise<Response> {
  const endpoint = process.env.AWS_ENDPOINT_URL_S3 || 'https://mock-storage.local'
  const bucket = process.env.BUCKET_NAME || 'mock-bucket'
  const mockStorageUrl = `${endpoint}/${bucket}/${objectKey}`
  
  const fetchHeaders: Record<string, string> = {}
  if (rangeHeader) {
    fetchHeaders['Range'] = rangeHeader
  }
  
  const response = await time(
    () => fetch(mockStorageUrl, { headers: fetchHeaders }),
    { timings, type: 'fetch audio from mock' }
  )
  
  if (!response.ok) {
    console.error(`Mock storage request failed: ${response.status} ${response.statusText}`)
    throw new Response('Audio file not found', { status: 404 })
  }
  
  return response
}

/**
 * Fetch audio from production storage using presigned URLs
 */
async function fetchFromProductionStorage(
  objectKey: string,
  rangeHeader: string | null,
  timings: ReturnType<typeof makeTimings>
): Promise<Response> {
  const { url: signedUrl, headers: signedHeaders } = await time(
    () => getFileUrl(objectKey, DEFAULT_SIGNED_URL_EXPIRY, timings),
    { timings, type: 'get signed url' }
  )
  
  const fetchHeaders = { ...signedHeaders }
  if (rangeHeader) {
    fetchHeaders['Range'] = rangeHeader
  }
  
  const response = await time(
    () => fetch(signedUrl, { headers: fetchHeaders }),
    { timings, type: 'fetch audio' }
  )
  
  if (!response.ok) {
    console.error(`Production storage request failed: ${response.status} ${response.statusText}`)
    throw new Response('Audio file not found', { status: 404 })
  }
  
  return response
}

export async function loader({ request }: Route.LoaderArgs) {
  const timings = makeTimings('audio loader')
  
  const url = new URL(request.url)
  const objectKey = url.searchParams.get('objectKey')
  invariantResponse(objectKey, 'objectKey query parameter is required', { status: 400 })
  
  const rangeHeader = request.headers.get('Range')
  
  try {
    // Choose storage method based on environment
    const response = process.env.MOCKS === 'true'
      ? await fetchFromMockStorage(objectKey, rangeHeader, timings)
      : await fetchFromProductionStorage(objectKey, rangeHeader, timings)
    
    return createAudioResponse(response, timings)
  } catch (error) {
    if (error instanceof Response) {
      throw error
    }
    
    console.error('Error serving audio file:', error)
    throw new Response('Internal Server Error', { status: 500 })
  }
}