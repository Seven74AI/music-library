import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, Form, useNavigation } from 'react-router'
import { GeneralErrorBoundary } from '#app/components/error-boundary'
import { Spacer } from '#app/components/spacer.tsx'
import { Alert, AlertDescription } from '#app/components/ui/alert.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { Textarea } from '#app/components/ui/textarea.tsx'
import {
	parseCookieLine,
	writeCookiesFile,
	readCookiesFile,
	type NetscapeCookie,
} from '#app/features/audio-archive/youtube-cookie.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithRole } from '#app/utils/permissions.server.ts'
import { type Route } from './+types/youtube-cookies.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

interface LoaderData {
	cookieCount: number
	fileExists: boolean
	lastUpload: {
		id: string
		updatedAt: Date
		updatedBy: string
		valid: boolean
	} | null
}

export async function loader({ request }: Route.LoaderArgs): Promise<LoaderData> {
	await requireUserWithRole(request, 'admin')

	const cookies = readCookiesFile()
	const lastUpload = await prisma.youtubeCookie.findFirst({
		orderBy: { updatedAt: 'desc' },
		select: { id: true, updatedAt: true, updatedBy: true, valid: true },
	})

	return {
		cookieCount: cookies.length,
		fileExists: cookies.length > 0,
		lastUpload,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserWithRole(request, 'admin')

	const formData = await request.formData()
	const mode = formData.get('mode')

	invariantResponse(
		mode === 'upload' || mode === 'paste',
		'Invalid mode: must be "upload" or "paste"',
	)

	let rawText: string | undefined

	if (mode === 'upload') {
		const file = formData.get('cookieFile')
		invariantResponse(file instanceof File, 'No file uploaded')
		invariantResponse(file.size > 0, 'Uploaded file is empty')
		invariantResponse(file.size < 1024 * 1024, 'File must be under 1MB')
		rawText = await file.text()
	} else {
		const pasted = formData.get('cookieText')
		invariantResponse(typeof pasted === 'string', 'No cookie text provided')
		invariantResponse(pasted.trim().length > 0, 'Cookie text is empty')
		rawText = pasted
	}

	// Parse cookies from the raw text
	const lines = rawText.split('\n')
	const cookies: NetscapeCookie[] = []
	let parseErrors = 0

	for (const line of lines) {
		const cookie = parseCookieLine(line)
		if (cookie) {
			cookies.push(cookie)
		} else if (line.trim() && !line.trim().startsWith('#')) {
			parseErrors++
		}
	}

	invariantResponse(cookies.length > 0, 'No valid cookies found in the provided content')

	// Write to cookie file (may fail on platforms without writable filesystem)
	let fileWritten = false
	try {
		writeCookiesFile(cookies)
		fileWritten = true
	} catch (err) {
		// Log but continue — DB record is the source of truth
		console.error('Failed to write cookie file:', err)
	}

	// Record in the database
	const record = await prisma.youtubeCookie.create({
		data: {
			updatedBy: userId,
			valid: true,
		},
	})

	// Mark any older records as invalid
	await prisma.youtubeCookie.updateMany({
		where: {
			id: { not: record.id },
			valid: true,
		},
		data: { valid: false },
	})

	return data({
		success: true,
		cookiesImported: cookies.length,
		parseErrors,
		recordId: record.id,
		fileWritten,
	})
}

export default function YoutubeCookiesAdminRoute({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const navigation = useNavigation()
	const isSubmitting = navigation.state === 'submitting'

	return (
		<div className="container">
			<h1 className="text-h1">YouTube Cookies</h1>
			<Spacer size="2xs" />

			{actionData && 'success' in actionData && actionData.success ? (
				<Alert variant="default" className="mb-4 border-green-500 bg-green-50 dark:bg-green-950">
					<AlertDescription>
						Successfully imported {actionData.cookiesImported} cookie
						{actionData.cookiesImported !== 1 ? 's' : ''}.
						{actionData.parseErrors > 0
							? ` (${actionData.parseErrors} line${actionData.parseErrors !== 1 ? 's' : ''} skipped)`
							: ''}
					</AlertDescription>
				</Alert>
			) : null}

			<div className="mb-6 rounded-lg border p-4">
				<h2 className="text-h3 mb-2">Current State</h2>
				<p className="text-muted-foreground">
					Cookies on disk:{' '}
					<span className="font-mono font-semibold">
						{loaderData.cookieCount}
					</span>
				</p>
				{loaderData.lastUpload ? (
					<p className="text-muted-foreground text-sm">
						Last upload:{' '}
						{loaderData.lastUpload.updatedAt.toLocaleString()}
						{' — '}
						{loaderData.lastUpload.valid ? 'Valid' : 'Superseded'}
					</p>
				) : (
					<p className="text-muted-foreground text-sm">No cookies uploaded yet.</p>
				)}
			</div>

			<div className="flex flex-col gap-6">
				{/* Upload File section */}
				<div className="rounded-lg border p-4">
					<h2 className="text-h3 mb-3">Upload Cookie File</h2>
					<p className="text-muted-foreground mb-4 text-sm">
						Upload a Netscape-format cookie file (.txt) exported from your browser.
					</p>
					<Form method="post" encType="multipart/form-data" className="flex flex-col gap-4">
						<input type="hidden" name="mode" value="upload" />
						<div>
							<Label htmlFor="cookieFile">Cookie File (.txt)</Label>
							<input
								id="cookieFile"
								name="cookieFile"
								type="file"
								accept=".txt"
								required
								className="mt-1 block w-full text-sm text-muted-foreground
									file:mr-4 file:rounded-md file:border-0
									file:bg-primary file:px-4 file:py-2
									file:text-sm file:font-semibold file:text-primary-foreground
									hover:file:bg-primary/90"
							/>
						</div>
						<div>
							<Button type="submit" disabled={isSubmitting}>
								{isSubmitting ? 'Uploading...' : 'Upload & Import'}
							</Button>
						</div>
					</Form>
				</div>

				{/* Paste section */}
				<div className="rounded-lg border p-4">
					<h2 className="text-h3 mb-3">Paste Cookie Content</h2>
					<p className="text-muted-foreground mb-4 text-sm">
						Paste the contents of a Netscape-format cookie file directly.
						Lines starting with # are treated as comments.
					</p>
					<Form method="post" className="flex flex-col gap-4">
						<input type="hidden" name="mode" value="paste" />
						<div>
							<Label htmlFor="cookieText">Cookie Content</Label>
							<Textarea
								id="cookieText"
								name="cookieText"
								rows={12}
								required
								placeholder={`# Netscape HTTP Cookie File
.youtube.com\tTRUE\t/\tTRUE\t1750000000\tLOGIN_INFO\taAbBcC==
.youtube.com\tTRUE\t/\tFALSE\t0\tPREF\tf1=50000000`}
								className="mt-1 font-mono text-xs"
							/>
						</div>
						<div>
							<Button type="submit" disabled={isSubmitting}>
								{isSubmitting ? 'Importing...' : 'Import Cookies'}
							</Button>
						</div>
					</Form>
				</div>
			</div>
		</div>
	)
}

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{
				403: ({ error }) => (
					<p>You must be an admin to manage YouTube cookies: {error?.data.message}</p>
				),
			}}
		/>
	)
}
