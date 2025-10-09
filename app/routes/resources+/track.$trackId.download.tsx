import { type LoaderFunctionArgs } from 'react-router'
import { requireUserId } from '#app/utils/auth.server'
import { prisma } from '#app/utils/db.server'
import { getFileUrl } from '#app/utils/storage.server'

/**
 * Fetch file from mock storage for download
 */
async function fetchFromMockStorage(objectKey: string): Promise<Response> {
  const endpoint = process.env.AWS_ENDPOINT_URL_S3 || 'https://mock-storage.local'
  const bucket = process.env.BUCKET_NAME || 'mock-bucket'
  const mockStorageUrl = `${endpoint}/${bucket}/${objectKey}`
  
  const response = await fetch(mockStorageUrl)
  
  if (!response.ok) {
    console.error(`Mock storage request failed: ${response.status} ${response.statusText}`)
    throw new Response('File not found', { status: 404 })
  }
  
  return response
}

/**
 * Fetch file from production storage for download
 */
async function fetchFromProductionStorage(objectKey: string): Promise<Response> {
  const { url: signedUrl, headers: signedHeaders } = await getFileUrl(objectKey, 300) // 5 minutes
  
  const response = await fetch(signedUrl, { headers: signedHeaders })
  
  if (!response.ok) {
    console.error(`Production storage request failed: ${response.status} ${response.statusText}`)
    throw new Response('File not found', { status: 404 })
  }
  
  return response
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireUserId(request)
  
  const trackId = params.trackId
  if (!trackId) {
    throw new Response('Track ID required', { status: 400 })
  }

  // Get track with audio file
  const track = await prisma.track.findUnique({
    where: { id: trackId },
    include: { audioFile: true },
  })

  if (!track?.audioFile?.objectKey) {
    throw new Response('Track or audio file not found', { status: 404 })
  }

  if (track.audioFile.status !== 'completed') {
    throw new Response('Audio file not ready', { status: 404 })
  }

  try {
    // Choose storage method based on environment
    const response = process.env.MOCKS === 'true'
      ? await fetchFromMockStorage(track.audioFile.objectKey)
      : await fetchFromProductionStorage(track.audioFile.objectKey)
    
    // Create safe filename
    const filename = `${track.title.replace(/[^a-zA-Z0-9\s]/g, '')}.mp3`

    // Return the file directly with download headers
    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'audio/mpeg',
        'Content-Length': response.headers.get('Content-Length') || '',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    })
  } catch (error) {
    if (error instanceof Response) {
      throw error
    }
    
    console.error('Download error:', error)
    throw new Response('Download failed', { status: 500 })
  }
}