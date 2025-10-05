// @context7: @epic-web/invariant, Fetch API, React, AWS S3
/* 
    Before answering my question, MANDATORY use Context7 to fetch documentation for:

    - @epic-web/invariant
    - Fetch API
    - React
    - AWS S3
    - resolve-library-id: @epic-web/invariant
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: Fetch API
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: React
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: AWS S3
    - get-library-docs: [resolved-id] (focus: general usage)

    Context7 Instructions:
    - resolve-library-id: @epic-web/invariant
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: Fetch API
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: React
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: AWS S3
    - get-library-docs: [resolved-id] (focus: general usage)

    ⚠️  DO NOT PROCEED WITHOUT FETCHING ALL DOCUMENTATION ABOVE!
*/
import { invariantResponse } from '@epic-web/invariant'
import { getSignedGetRequestInfo } from '#app/utils/storage.server.ts'
import { type Route } from './+types/audio'

export async function loader({ request }: Route.LoaderArgs) {
	const url = new URL(request.url)
	const searchParams = url.searchParams

	const headers = new Headers()
	headers.set('Cache-Control', 'public, max-age=31536000, immutable')

	const objectKey = searchParams.get('objectKey')
	invariantResponse(objectKey, 'objectKey query parameter is required', { status: 400 })

	const { url: signedUrl, headers: signedHeaders } = getSignedGetRequestInfo(objectKey)

	// Fetch the audio file from storage
	const response = await fetch(signedUrl, {
		headers: signedHeaders,
	})

	if (!response.ok) {
		throw new Response('Audio file not found', { status: 404 })
	}

	// Get the audio file content
	const audioBuffer = await response.arrayBuffer()

	// Return the audio file with appropriate headers
	return new Response(audioBuffer, {
		headers: {
			'Content-Type': response.headers.get('Content-Type') || 'audio/mpeg',
			'Content-Length': audioBuffer.byteLength.toString(),
			'Cache-Control': 'public, max-age=31536000, immutable',
		},
	})
}