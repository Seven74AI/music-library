/**
 * Format bytes to human-readable file size
 * @param bytes - File size in bytes
 * @returns Formatted file size string (e.g., "1.23 MB", "N/A")
 */
export function formatFileSize(bytes: number | null | undefined): string {
	if (!bytes || bytes === 0) return 'N/A'
	
	const units = ['B', 'KB', 'MB', 'GB', 'TB']
	let size = bytes
	let unitIndex = 0
	
	// Convert to appropriate unit
	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024
		unitIndex++
	}
	
	// Format with appropriate decimal places
	const decimals = unitIndex === 0 ? 0 : size < 10 ? 2 : 1
	return `${size.toFixed(decimals)} ${units[unitIndex]}`
}
