import { describe, expect, test, vi, beforeEach } from 'vitest'
import { searchAll } from '#app/utils/search.server.ts'
import { loader } from './search.tsx'

vi.mock('#app/utils/search.server.ts', () => ({
	searchAll: vi.fn(),
}))

function makeRequest(url: string) {
	return { request: new Request(url), url: new URL(url) }
}

describe('search API loader', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	test('returns 400 when query parameter is missing', async () => {
		const response = await loader({
			...makeRequest('http://localhost/api/search'),
		} as never)

		expect(response.status).toBe(400)
		expect(searchAll).not.toHaveBeenCalled()
		const body = (await response.json()) as { error: string }
		expect(body.error).toBe('Invalid search parameters')
	})

	test('returns 400 when limit is invalid', async () => {
		const response = await loader({
			...makeRequest('http://localhost/api/search?q=test&limit=invalid'),
		} as never)

		expect(response.status).toBe(400)
		expect(searchAll).not.toHaveBeenCalled()
	})

	test('returns search results for valid parameters', async () => {
		vi.mocked(searchAll).mockResolvedValue({
			results: [],
			pagination: { limit: 20, hasNext: false, nextCursor: null },
		})

		const response = await loader({
			...makeRequest('http://localhost/api/search?q=test'),
		} as never)

		expect(response.status).toBe(200)
		expect(searchAll).toHaveBeenCalledWith('test', 20, undefined, 'all', true)
		const body = await response.json()
		expect(body).toHaveProperty('results')
		expect(body).toHaveProperty('pagination')
	})
})
