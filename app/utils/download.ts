/**
 * Utility function to download a file without navigating away from the current page
 */
export function downloadFile(url: string, filename?: string) {
	// Create a temporary anchor element
	const link = document.createElement('a')
	link.href = url
	link.download = filename || 'download'
	
	// Append to body, click, and remove
	document.body.appendChild(link)
	link.click()
	document.body.removeChild(link)
}

/**
 * Utility function to download a track by ID
 */
export async function downloadTrack(trackId: string, filename?: string) {
	try {
		// First, fetch the download URL to get the redirect location
		const response = await fetch(`/resources/track/${trackId}/download`, {
			method: 'HEAD', // Use HEAD to avoid downloading the file
			redirect: 'manual' // Don't follow redirects automatically
		})
		
		if (response.status === 302) {
			// Get the redirect location
			const redirectUrl = response.headers.get('Location')
			if (redirectUrl) {
				// Use the redirect URL for download
				downloadFile(redirectUrl, filename)
				return
			}
		}
		
		// Fallback: if we can't get the redirect URL, use the original approach
		// but open in a new tab to avoid navigation
		window.open(`/resources/track/${trackId}/download`, '_blank')
	} catch (error) {
		console.error('Download failed:', error)
		// Final fallback: open in new tab
		window.open(`/resources/track/${trackId}/download`, '_blank')
	}
}
