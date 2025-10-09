/**
 * YouTube Mocking Utilities
 * 
 * Simple utility to determine when YouTube API should be mocked
 * based on environment variables.
 */

/**
 * Determines if YouTube API should return mock data
 * 
 * Logic:
 * - YOUTUBE_MOCKS=true → Always mock
 * - YOUTUBE_MOCKS=false → Never mock (overrides MOCKS)
 * - YOUTUBE_MOCKS not set → Follow MOCKS environment variable
 * 
 * @returns true if YouTube API should be mocked, false otherwise
 */
export function shouldMockYouTube(): boolean {
  // Explicit YouTube mock setting takes priority
  if (process.env.YOUTUBE_MOCKS === 'true') {
    return true
  }
  
  if (process.env.YOUTUBE_MOCKS === 'false') {
    return false
  }
  
  // If YOUTUBE_MOCKS is not set, follow the general MOCKS setting
  return process.env.MOCKS === 'true'
}
