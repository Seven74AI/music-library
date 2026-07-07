import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
	cookiesFromKeyValues,
	deleteCookiesFile,
	parseCookieLine,
	readCookiesFile,
	serializeCookieLine,
	writeCookiesFile,
	type NetscapeCookie,
} from './youtube-cookie.server.ts'

function tmpPath(name: string): string {
	return path.join(os.tmpdir(), `music-library-test-${name}`)
}

describe('serializeCookieLine', () => {
	it('serializes a valid cookie to Netscape format', () => {
		const cookie: NetscapeCookie = {
			domain: '.youtube.com',
			flag: 'TRUE',
			path: '/',
			secure: 'TRUE',
			expires: 1750000000,
			name: 'LOGIN_INFO',
			value: 'aAbBcC==',
		}
		expect(serializeCookieLine(cookie)).toBe(
			'.youtube.com\tTRUE\t/\tTRUE\t1750000000\tLOGIN_INFO\taAbBcC==',
		)
	})

	it('handles session cookies (expires=0)', () => {
		const cookie: NetscapeCookie = {
			domain: '.youtube.com',
			flag: 'FALSE',
			path: '/',
			secure: 'FALSE',
			expires: 0,
			name: 'PREF',
			value: 'f1=50000000',
		}
		expect(serializeCookieLine(cookie)).toBe(
			'.youtube.com\tFALSE\t/\tFALSE\t0\tPREF\tf1=50000000',
		)
	})

	it('handles special characters in values', () => {
		const cookie: NetscapeCookie = {
			domain: '.youtube.com',
			flag: 'TRUE',
			path: '/',
			secure: 'TRUE',
			expires: 1750000000,
			name: 'SID',
			value: 'abc.def-ghi_jkl==',
		}
		const line = serializeCookieLine(cookie)
		// The cookie value may contain special chars but tabs are the issue - they break parsing
		expect(line).not.toContain('\t\t') // no empty fields
		expect(line.split('\t')).toHaveLength(7)
	})
})

describe('parseCookieLine', () => {
	it('parses a valid Netscape-format line', () => {
		const line = '.youtube.com\tTRUE\t/\tTRUE\t1750000000\tLOGIN_INFO\taAbBcC=='
		const result = parseCookieLine(line)
		expect(result).toEqual({
			domain: '.youtube.com',
			flag: 'TRUE',
			path: '/',
			secure: 'TRUE',
			expires: 1750000000,
			name: 'LOGIN_INFO',
			value: 'aAbBcC==',
		})
	})

	it('returns null for comment lines', () => {
		expect(parseCookieLine('# Netscape HTTP Cookie File')).toBeNull()
		expect(parseCookieLine('# This is a comment')).toBeNull()
	})

	it('returns null for blank lines', () => {
		expect(parseCookieLine('')).toBeNull()
		expect(parseCookieLine('   ')).toBeNull()
	})

	it('returns null for lines with wrong field count', () => {
		expect(parseCookieLine('.youtube.com\tTRUE\t/\tTRUE\t0\tNAME')).toBeNull()
		expect(parseCookieLine('.youtube.com\tTRUE\t/\tTRUE\t0\tNAME\tVALUE\tEXTRA')).toBeNull()
	})

	it('returns null for invalid flag/secure values', () => {
		expect(parseCookieLine('.youtube.com\tINVALID\t/\tTRUE\t0\tNAME\tVALUE')).toBeNull()
		expect(parseCookieLine('.youtube.com\tTRUE\t/\tINVALID\t0\tNAME\tVALUE')).toBeNull()
	})

	it('returns null for invalid expires value', () => {
		expect(parseCookieLine('.youtube.com\tTRUE\t/\tTRUE\tabc\tNAME\tVALUE')).toBeNull()
		expect(parseCookieLine('.youtube.com\tTRUE\t/\tTRUE\t-1\tNAME\tVALUE')).toBeNull()
	})
})

describe('writeCookiesFile / readCookiesFile', () => {
	const testFile = tmpPath('cookies-test.txt')

	beforeEach(() => {
		deleteCookiesFile(testFile)
	})

	it('writes and reads cookies in Netscape format', () => {
		const cookies = [
			{
				domain: '.youtube.com',
				flag: 'TRUE' as const,
				path: '/',
				secure: 'TRUE' as const,
				expires: 1750000000,
				name: 'LOGIN_INFO',
				value: 'abc123',
			},
			{
				domain: '.youtube.com',
				flag: 'FALSE' as const,
				path: '/',
				secure: 'FALSE' as const,
				expires: 0,
				name: 'PREF',
				value: 'f1=50000000',
			},
		]

		writeCookiesFile(cookies, testFile)

		expect(fs.existsSync(testFile)).toBe(true)

		const read = readCookiesFile(testFile)
		expect(read).toHaveLength(2)
		expect(read[0]).toEqual(cookies[0])
		expect(read[1]).toEqual(cookies[1])
	})

	it('writes valid Netscape-format file with header', () => {
		const cookies = [
			{
				domain: '.youtube.com',
				flag: 'TRUE' as const,
				path: '/',
				secure: 'TRUE' as const,
				expires: 1750000000,
				name: 'SID',
				value: 'test123',
			},
		]

		writeCookiesFile(cookies, testFile)

		const content = fs.readFileSync(testFile, 'utf-8')
		expect(content).toContain('# Netscape HTTP Cookie File')
		expect(content).toContain('# This is a generated file! Do not edit.')
		expect(content).toContain('.youtube.com\tTRUE\t/\tTRUE\t1750000000\tSID\ttest123')
	})

	it('returns empty array when file does not exist', () => {
		const result = readCookiesFile('/nonexistent/path/cookies.txt')
		expect(result).toEqual([])
	})

	it('round-trips through empty array', () => {
		writeCookiesFile([], testFile)
		const read = readCookiesFile(testFile)
		expect(read).toEqual([])
	})

	it('creates parent directories when writing', () => {
		const deepPath = tmpPath('deep/nested/cookies.txt')
		const cookies = [
			{
				domain: '.example.com',
				flag: 'TRUE' as const,
				path: '/',
				secure: 'FALSE' as const,
				expires: 0,
				name: 'test',
				value: 'value',
			},
		]

		// Ensure cleanup
		deleteCookiesFile(deepPath)
		try {
			fs.rmdirSync(path.dirname(deepPath), { recursive: true })
		} catch {
			// ignore
		}

		writeCookiesFile(cookies, deepPath)
		expect(fs.existsSync(deepPath)).toBe(true)

		// Cleanup
		deleteCookiesFile(deepPath)
		try {
			fs.rmdirSync(path.dirname(path.dirname(deepPath)), { recursive: true })
		} catch {
			// ignore
		}
	})
})

describe('cookiesFromKeyValues', () => {
	it('converts key-value pairs to cookie objects', () => {
		const result = cookiesFromKeyValues('.youtube.com', {
			LOGIN_INFO: 'abc123',
			PREF: 'f1=50000000',
		})

		expect(result).toHaveLength(2)
		expect(result[0]).toEqual({
			domain: '.youtube.com',
			flag: 'TRUE',
			path: '/',
			secure: 'TRUE',
			expires: 0,
			name: 'LOGIN_INFO',
			value: 'abc123',
		})
	})

	it('accepts option overrides', () => {
		const result = cookiesFromKeyValues(
			'.example.com',
			{ token: 'xyz' },
			{ flag: 'FALSE', path: '/api', secure: 'FALSE', expires: 1750000000 },
		)

		expect(result).toHaveLength(1)
		expect(result[0]).toEqual({
			domain: '.example.com',
			flag: 'FALSE',
			path: '/api',
			secure: 'FALSE',
			expires: 1750000000,
			name: 'token',
			value: 'xyz',
		})
	})
})

describe('deleteCookiesFile', () => {
	it('deletes an existing file', () => {
		const testFile = tmpPath('delete-test.txt')
		writeCookiesFile(
			[
				{
					domain: '.test.com',
					flag: 'TRUE',
					path: '/',
					secure: 'FALSE',
					expires: 0,
					name: 'test',
					value: 'val',
				},
			],
			testFile,
		)

		expect(fs.existsSync(testFile)).toBe(true)

		deleteCookiesFile(testFile)

		expect(fs.existsSync(testFile)).toBe(false)
	})

	it('does not throw when file does not exist', () => {
		expect(() => deleteCookiesFile('/nonexistent/test.txt')).not.toThrow()
	})
})
