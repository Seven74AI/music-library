import { describe, expect, test, vi } from 'vitest'
import { proxyClientActionToServer } from './server-proxy-client-action.ts'

describe('proxyClientActionToServer', () => {
	test('delegates to serverAction', async () => {
		const serverAction = vi.fn().mockResolvedValue({ status: 'success' })

		const result = await proxyClientActionToServer({ serverAction })

		expect(serverAction).toHaveBeenCalledOnce()
		expect(result).toEqual({ status: 'success' })
	})
})
