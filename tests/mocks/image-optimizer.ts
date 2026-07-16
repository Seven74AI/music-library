import { http, HttpResponse } from 'msw'

// 1×1 transparent PNG (base64)
const PIXEL =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

export const handlers = [
	http.get('/resources/images', ({ request }) => {
		// Matches /resources/images and /resources/images?src=...&w=...&h=...
		// regardless of query parameters
		return new HttpResponse(Buffer.from(PIXEL, 'base64'), {
			headers: { 'Content-Type': 'image/png' },
		})
	}),
]
