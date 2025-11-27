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


