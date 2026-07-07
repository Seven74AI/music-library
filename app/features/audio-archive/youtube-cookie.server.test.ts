import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
	parseCookieLine,
	readCookies,
	writeCookies,
} from './youtube-cookie.server.ts'

function tmpPath(name: string): string {
	return path.join(os.tmpdir(), `music-library-test-${name}`)
}

describe('parseCookieLine', () => {
	it('parses a valid Netscape-format line', () => {
		const line =
			'.youtube.com\tTRUE\t/\tTRUE\t1750000000\tLOGIN_INFO\taAbBcC=='
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
		expect(
			parseCookieLine('.youtube.com\tTRUE\t/\tTRUE\t0\tNAME'),
		).toBeNull()
		expect(
			parseCookieLine(
				'.youtube.com\tTRUE\t/\tTRUE\t0\tNAME\tVALUE\tEXTRA',
			),
		).toBeNull()
	})

	it('returns null for invalid flag/secure values', () => {
		expect(
			parseCookieLine(
				'.youtube.com\tINVALID\t/\tTRUE\t0\tNAME\tVALUE',
			),
		).toBeNull()
		expect(
			parseCookieLine(
				'.youtube.com\tTRUE\t/\tINVALID\t0\tNAME\tVALUE',
			),
		).toBeNull()
	})

	it('returns null for invalid expires value', () => {
		expect(
			parseCookieLine(
				'.youtube.com\tTRUE\t/\tTRUE\tabc\tNAME\tVALUE',
			),
		).toBeNull()
		expect(
			parseCookieLine(
				'.youtube.com\tTRUE\t/\tTRUE\t-1\tNAME\tVALUE',
			),
		).toBeNull()
	})
})

describe('writeCookies / readCookies', () => {
	const testFile = tmpPath('cookies-test.txt')

	beforeEach(() => {
		writeCookies([], testFile)
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

		writeCookies(cookies, testFile)

		expect(fs.existsSync(testFile)).toBe(true)

		const read = readCookies(testFile)
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

		writeCookies(cookies, testFile)

		const content = fs.readFileSync(testFile, 'utf-8')
		expect(content).toContain('# Netscape HTTP Cookie File')
		expect(content).toContain(
			'# This is a generated file! Do not edit.',
		)
		expect(content).toContain(
			'.youtube.com\tTRUE\t/\tTRUE\t1750000000\tSID\ttest123',
		)
	})

	it('returns empty array when file does not exist', () => {
		const result = readCookies('/nonexistent/path/cookies.txt')
		expect(result).toEqual([])
	})

	it('deletes file when writing empty array', () => {
		writeCookies(
			[
				{
					domain: '.test.com',
					flag: 'TRUE' as const,
					path: '/',
					secure: 'FALSE' as const,
					expires: 0,
					name: 'test',
					value: 'val',
				},
			],
			testFile,
		)
		expect(fs.existsSync(testFile)).toBe(true)

		writeCookies([], testFile)
		expect(fs.existsSync(testFile)).toBe(false)
	})

	it('does not throw when deleting non-existent file', () => {
		expect(() =>
			writeCookies([], '/nonexistent/test.txt'),
		).not.toThrow()
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
		writeCookies([], deepPath)
		try {
			fs.rmdirSync(path.dirname(deepPath), { recursive: true })
		} catch {
			// ignore
		}

		writeCookies(cookies, deepPath)
		expect(fs.existsSync(deepPath)).toBe(true)

		// Cleanup
		writeCookies([], deepPath)
		try {
			fs.rmdirSync(path.dirname(path.dirname(deepPath)), {
				recursive: true,
			})
		} catch {
			// ignore
		}
	})
})
