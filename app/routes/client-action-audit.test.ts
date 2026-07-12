import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROUTES_DIR = join(fileURLToPath(new URL('.', import.meta.url)))
const APP_DIR = join(ROUTES_DIR, '..')

function walkFiles(dir: string): string[] {
	return readdirSync(dir).flatMap(entry => {
		const fullPath = join(dir, entry)
		if (statSync(fullPath).isDirectory()) return walkFiles(fullPath)
		if (/\.(tsx|ts)$/.test(entry)) return [fullPath]
		return []
	})
}

function hasExportedAction(source: string): boolean {
	return /export\s+(async\s+)?function\s+action\s*\(/.test(source)
}

function hasClientAction(source: string): boolean {
	return /export\s+(async\s+)?function\s+clientAction\s*\(/.test(source)
}

function usesFetcherInRouteModule(source: string): boolean {
	return /\buseFetcher\s*[<(]/.test(source)
}

function submitsToOwnAction(source: string): boolean {
	if (/<[\w$]+\.Form\b(?![^>]*\baction=)/.test(source)) {
		return true
	}

	for (const match of source.matchAll(/\.submit\(([\s\S]*?)\)/g)) {
		const args = match[1] ?? ''
		if (!/method:\s*['"]post['"]/i.test(args)) continue

		const optionsMatch = args.match(/,\s*\{([\s\S]*)\}\s*$/)
		if (!optionsMatch) continue

		const options = optionsMatch[1] ?? ''
		if (!/\baction\s*:/.test(options)) return true
	}

	return false
}

/** Map fetcher.submit action URLs to route module paths under app/routes. */
function actionUrlToRouteFile(actionUrl: string): string | null {
	const normalized = actionUrl.replace(/^\//, '')
	const segments = normalized.split('/').filter(Boolean)
	if (segments.length === 0) return null

	if (segments[0] === 'resources') {
		const resource = segments.slice(1).join('.')
		return join(ROUTES_DIR, 'resources+', `${resource}.tsx`)
	}

	return null
}

function collectFetcherSubmitTargets(): Map<string, Set<string>> {
	const targets = new Map<string, Set<string>>()
	const sourceFiles = walkFiles(APP_DIR).filter(
		path => !path.includes('.test.') && !path.includes('.server.test.'),
	)

	for (const filePath of sourceFiles) {
		const source = readFileSync(filePath, 'utf8')
		const rel = relative(APP_DIR, filePath)

		for (const match of source.matchAll(/action:\s*['"`](\/[^'"`]+)['"`]/g)) {
			const actionUrl = match[1]
			if (!actionUrl) continue
			const routeFile = actionUrlToRouteFile(actionUrl)
			if (!routeFile) continue
			const existing = targets.get(routeFile) ?? new Set()
			existing.add(rel)
			targets.set(routeFile, existing)
		}
	}

	return targets
}

describe('clientAction audit', () => {
	const routeFiles = walkFiles(ROUTES_DIR).filter(
		path => !path.endsWith('.test.ts') && !path.endsWith('.test.tsx'),
	)
	const fetcherSubmitTargets = collectFetcherSubmitTargets()

	test('routes using useFetcher to submit to their own action export clientAction', () => {
		const missing: string[] = []

		for (const filePath of routeFiles) {
			const source = readFileSync(filePath, 'utf8')
			if (!hasExportedAction(source) || !usesFetcherInRouteModule(source)) continue
			if (!submitsToOwnAction(source)) continue
			if (!hasClientAction(source)) {
				missing.push(relative(process.cwd(), filePath))
			}
		}

		expect(missing, `Missing clientAction:\n${missing.join('\n')}`).toEqual([])
	})

	test('routes targeted by fetcher.submit export clientAction', () => {
		const missing: Array<{ route: string; referencedFrom: string[] }> = []

		for (const [routeFile, referencedFrom] of fetcherSubmitTargets) {
			let source: string
			try {
				source = readFileSync(routeFile, 'utf8')
			} catch {
				missing.push({
					route: relative(process.cwd(), routeFile),
					referencedFrom: [...referencedFrom, '(route file not found)'],
				})
				continue
			}

			if (!hasExportedAction(source)) continue
			if (!hasClientAction(source)) {
				missing.push({
					route: relative(process.cwd(), routeFile),
					referencedFrom: [...referencedFrom],
				})
			}
		}

		expect(missing).toEqual([])
	})
})
