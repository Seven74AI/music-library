import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
	sendTelegramMessage,
	notifyCookieExpired,
	notifyJobFailed,
} from './notification.server.ts'

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

/** Helper: get the parsed JSON body from the last fetch call */
function getFetchBody(): Record<string, unknown> {
	const call = mockFetch.mock.calls[0] as [string, { body: string }] | undefined
	if (!call) throw new Error('fetch was not called')
	return JSON.parse(call[1].body) as Record<string, unknown>
}

describe('sendTelegramMessage', () => {
	const originalEnv = { ...process.env }

	beforeEach(() => {
		vi.clearAllMocks()
		process.env = { ...originalEnv }
	})

	it('returns false when TELEGRAM_BOT_TOKEN is not set', async () => {
		delete process.env.TELEGRAM_BOT_TOKEN
		process.env.TELEGRAM_ADMIN_CHAT_ID = '123456'

		const result = await sendTelegramMessage('test message')
		expect(result).toBe(false)
		expect(mockFetch).not.toHaveBeenCalled()
	})

	it('returns false when TELEGRAM_ADMIN_CHAT_ID is not set', async () => {
		process.env.TELEGRAM_BOT_TOKEN = 'fake-token'
		delete process.env.TELEGRAM_ADMIN_CHAT_ID

		const result = await sendTelegramMessage('test message')
		expect(result).toBe(false)
		expect(mockFetch).not.toHaveBeenCalled()
	})

	it('sends a POST request to the Telegram API', async () => {
		process.env.TELEGRAM_BOT_TOKEN = 'bot123:abc'
		process.env.TELEGRAM_ADMIN_CHAT_ID = '987654'

		mockFetch.mockResolvedValue(
			new Response(JSON.stringify({ ok: true, result: {} }), {
				status: 200,
			}),
		)

		const result = await sendTelegramMessage('hello world')
		expect(result).toBe(true)

		expect(mockFetch).toHaveBeenCalledTimes(1)
		expect(mockFetch).toHaveBeenCalledWith(
			'https://api.telegram.org/botbot123:abc/sendMessage',
			expect.objectContaining({
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
			}),
		)

		const body = getFetchBody()
		expect(body.chat_id).toBe('987654')
		expect(body.text).toBe('hello world')
		expect(body.parse_mode).toBe('HTML')
	})

	it('returns false when Telegram API returns ok: false', async () => {
		process.env.TELEGRAM_BOT_TOKEN = 'bot123:abc'
		process.env.TELEGRAM_ADMIN_CHAT_ID = '987654'

		mockFetch.mockResolvedValue(
			new Response(
				JSON.stringify({
					ok: false,
					description: 'Bad Request: chat not found',
				}),
				{ status: 400 },
			),
		)

		const result = await sendTelegramMessage('hello')
		expect(result).toBe(false)
	})

	it('returns false on network error', async () => {
		process.env.TELEGRAM_BOT_TOKEN = 'bot123:abc'
		process.env.TELEGRAM_ADMIN_CHAT_ID = '987654'

		mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))

		const result = await sendTelegramMessage('hello')
		expect(result).toBe(false)
	})
})

describe('notifyCookieExpired', () => {
	const originalEnv = { ...process.env }

	beforeEach(() => {
		vi.clearAllMocks()
		process.env = { ...originalEnv }
		process.env.TELEGRAM_BOT_TOKEN = 'bot:token'
		process.env.TELEGRAM_ADMIN_CHAT_ID = '123'
		mockFetch.mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), { status: 200 }),
		)
	})

	it('sends a cookie expired notification with job details', async () => {
		await notifyCookieExpired(
			'job-abc',
			'https://youtube.com/watch?v=dQw4w9WgXcQ',
			'HTTP Error 403: Forbidden',
		)

		expect(mockFetch).toHaveBeenCalledTimes(1)
		const body = getFetchBody()
		const text = body.text as string
		expect(text).toContain('Cookie Expired')
		expect(text).toContain('job-abc')
		expect(text).toContain('youtube.com')
		expect(text).toContain('403')
		expect(text).toContain('<b>')
		expect(text).toContain('<i>')
		expect(text).not.toContain('<script>')
	})

	it('escapes HTML in the track URL', async () => {
		await notifyCookieExpired('j1', '<script>alert("xss")</script>', 'error')

		const text = getFetchBody().text as string
		expect(text).toContain('&lt;script&gt;')
		expect(text).not.toContain('<script>')
	})
})

describe('notifyJobFailed', () => {
	const originalEnv = { ...process.env }

	beforeEach(() => {
		vi.clearAllMocks()
		process.env = { ...originalEnv }
		process.env.TELEGRAM_BOT_TOKEN = 'bot:token'
		process.env.TELEGRAM_ADMIN_CHAT_ID = '123'
		mockFetch.mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), { status: 200 }),
		)
	})

	it('sends a job failed notification with all details', async () => {
		await notifyJobFailed(
			'job-xyz',
			'https://youtube.com/watch?v=abcdef',
			'GEO_BLOCKED',
			'Video not available in your country',
		)

		expect(mockFetch).toHaveBeenCalledTimes(1)
		const text = getFetchBody().text as string
		expect(text).toContain('Archive Job Failed')
		expect(text).toContain('job-xyz')
		expect(text).toContain('GEO_BLOCKED')
		expect(text).toContain('not available')
	})

	it('escapes HTML in all fields', async () => {
		await notifyJobFailed('j1', '<a>', '&amp;', '<b>')

		const text = getFetchBody().text as string
		expect(text).toContain('&lt;a&gt;')
		expect(text).toContain('&amp;amp;')
		expect(text).toContain('&lt;b&gt;')
	})
})
