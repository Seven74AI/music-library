import { http, HttpResponse } from 'msw'

// 1×1 transparent PNG (base64)
const PIXEL =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

export const handlers = [
	http.get('*/resources/images', () => {
		// Wildcard matches both relative (/resources/images) and absolute
		// (http://localhost:3000/resources/images?src=...) URLs
		return new HttpResponse(Buffer.from(PIXEL, 'base64'), {
			headers: { 'Content-Type': 'image/png' },
		})
	}),
]
