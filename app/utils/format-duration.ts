/**
 * Format seconds to MM:SS or HH:MM:SS
 * This is a client-safe utility function
 */
export function formatDuration(seconds: number | null): string {
  // Handle null or invalid input
  if (seconds === null || typeof seconds !== 'number' || isNaN(seconds) || seconds < 0) {
    return '--:--'
  }
  
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
  }
  
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}
