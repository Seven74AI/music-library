// Client-safe audio archive utilities

export interface ErrorHistoryEntry {
  code: string
  message: string
  attemptAt: string
  retryCount: number
}

/**
 * Get the latest error from error history (client-safe)
 */
export function getCurrentError(errorHistory: string | null): ErrorHistoryEntry | null {
  if (!errorHistory) return null
  
  try {
    const errors: ErrorHistoryEntry[] = JSON.parse(errorHistory) as ErrorHistoryEntry[]
    return errors[errors.length - 1] || null
  } catch {
    return null
  }
}
