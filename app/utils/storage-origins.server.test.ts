import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getStorageOrigins } from './storage.server'

const STORAGE_ENV_KEYS = [
	'AWS_ENDPOINT_URL_S3',
	'BUCKET_NAME',
	'AWS_ACCESS_KEY_ID',
	'AWS_SECRET_ACCESS_KEY',
	'AWS_REGION',
] as const

describe('getStorageOrigins', () => {
	let savedEnv: Record<string, string | undefined>

	beforeEach(() => {
		savedEnv = {}
		for (const key of STORAGE_ENV_KEYS) {
			savedEnv[key] = process.env[key]
		}
	})

	afterEach(() => {
		for (const key of STORAGE_ENV_KEYS) {
			if (savedEnv[key] === undefined) {
				delete process.env[key]
			} else {
				process.env[key] = savedEnv[key]
			}
		}
	})

	it('returns both the endpoint origin and the virtual-hosted bucket origin', () => {
		process.env.AWS_ENDPOINT_URL_S3 = 'https://fly.storage.tigris.dev'
		process.env.BUCKET_NAME = 'my-bucket'
		process.env.AWS_ACCESS_KEY_ID = 'key'
		process.env.AWS_SECRET_ACCESS_KEY = 'secret'
		process.env.AWS_REGION = 'auto'

		expect(getStorageOrigins()).toEqual([
			'https://fly.storage.tigris.dev',
			'https://my-bucket.fly.storage.tigris.dev',
		])
	})

	it('returns an empty list when storage is not configured', () => {
		for (const key of STORAGE_ENV_KEYS) {
			delete process.env[key]
		}

		expect(getStorageOrigins()).toEqual([])
	})
})
