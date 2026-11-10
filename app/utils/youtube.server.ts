import { google, type youtube_v3 } from "googleapis";
import { YOUTUBE_API_VERSION } from "#app/config/youtube";
import {
  YouTubePlaylistListResponseSchema,
  YouTubePlaylistItemListResponseSchema,
  YouTubeVideoListResponseSchema,
  type YouTubePlaylistItem,
  type YouTubePlaylist,
  type YouTubePlaylistListResponse,
  type YouTubePlaylistItemListResponse,
  type YouTubeVideoListResponse,
} from "#app/types/youtube-api";
import { chunkArray } from "#app/utils/chunk-array";
import {
  createFakerYouTubePlaylist,
  createFakerYouTubePlaylistItem,
} from "#app/utils/mock-generators";
import { validateYouTubeAPIResponse } from "#app/utils/validation";
import {
  YouTubeAPIError,
  YouTubeNotFoundError,
  YOUTUBE_ERROR_CODES,
  YOUTUBE_PLAYLISTS_CLIENT_ERROR_MESSAGE,
  YOUTUBE_PLAYLIST_ITEMS_CLIENT_ERROR_MESSAGE,
  rethrowIfYouTubeDomainError,
  throwFromYouTubeGoogleApiError,
  throwFromYouTubeTransportError,
} from "#app/utils/youtube-errors";
import { shouldMockYouTube } from "#app/utils/youtube-mock-utils";

const VIDEOS_LIST_BATCH_SIZE = 50;

/**
 * Channel identity used while YouTube mocking is on. Mocked OAuth hands out
 * `mock-access-token`, which Google rejects, so the callback needs a stable
 * channel id to store a Connection without calling channels.list.
 */
const MOCK_YOUTUBE_CHANNEL = {
  id: "mock-youtube-channel",
  email: "",
  name: "Mock YouTube Channel",
} as const;

export class YouTubeService {
  private youtube: youtube_v3.Youtube;
  public readonly name = "youtube";

  constructor(apiKey?: string) {
    // API key is optional - some operations use OAuth instead
    this.youtube = google.youtube({
      version: YOUTUBE_API_VERSION,
      auth: apiKey,
    });
  }

  /**
   * Get YouTube user info
   */
  async getYouTubeUserInfo(
    accessToken: string,
  ): Promise<{ id: string; email: string; name: string }> {
    // Return mock data when mocking is enabled
    if (shouldMockYouTube()) {
      return { ...MOCK_YOUTUBE_CHANNEL };
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });

    const youtube = google.youtube({
      version: YOUTUBE_API_VERSION,
      auth: oauth2Client,
    });

    try {
      const response = await youtube.channels.list({
        part: ["snippet"],
        mine: true,
      });

      if (!response.data.items || response.data.items.length === 0) {
        throw new Error("No YouTube channel found. Please make sure you have a YouTube channel.");
      }

      const channel = response.data.items[0];
      if (!channel?.id) {
        throw new Error("No valid YouTube channel ID found");
      }

      return {
        id: channel.id,
        email: "", // YouTube API doesn't provide email in channels.list
        name: channel.snippet?.title || "Unknown",
      };
    } catch (error) {
      console.error("Error fetching YouTube user info:", error);
      if (error instanceof Error) {
        throw new Error(`Failed to fetch YouTube user information: ${error.message}`, {
          cause: error,
        });
      }
      throw new Error("Failed to fetch YouTube user information", { cause: error });
    }
  }

  /**
   * Get user's YouTube playlists
   * Fetches all playlists using cursor pagination (similar to getPlaylistItems)
   *
   * @param accessToken - OAuth access token
   * @param maxResults - Maximum results per page (default: 50, max: 50)
   * @returns Promise resolving to all playlists across all pages
   */
  async getUserPlaylists(accessToken: string, maxResults = 50): Promise<YouTubePlaylist[]> {
    // Return mock data when mocking is enabled
    if (shouldMockYouTube()) {
      return this.getMockUserPlaylists();
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });

    const youtube = google.youtube({
      version: YOUTUBE_API_VERSION,
      auth: oauth2Client,
    });

    try {
      const allPlaylists: YouTubePlaylist[] = [];
      let nextPageToken: string | undefined = undefined;

      // Loop through all pages until no more nextPageToken
      do {
        const response = await youtube.playlists.list({
          part: ["snippet", "contentDetails"],
          mine: true,
          maxResults: Math.min(maxResults, 50), // YouTube API max is 50
          pageToken: nextPageToken,
        });

        // Validate API response with new type-safe architecture
        const validatedResponse = validateYouTubeAPIResponse(
          response.data,
          YouTubePlaylistListResponseSchema,
        ) as YouTubePlaylistListResponse;

        // Add playlists from this page to the accumulated array
        if (validatedResponse.items) {
          allPlaylists.push(...validatedResponse.items);
        }

        // Get nextPageToken for next iteration
        nextPageToken = validatedResponse.nextPageToken;
      } while (nextPageToken);

      return allPlaylists;
    } catch (error) {
      console.error("Error fetching YouTube playlists:", error);

      if (error && typeof error === "object" && "response" in error) {
        const apiError = error as {
          response?: {
            data?: {
              error?: {
                code?: number;
                message?: string;
                errors?: Array<{ message?: string; reason?: string }>;
              };
            };
          };
        };
        const errorData = apiError.response?.data?.error;

        if (errorData) {
          throwFromYouTubeGoogleApiError(errorData, "playlists");
        }
      }

      rethrowIfYouTubeDomainError(error);

      if (error instanceof Error) {
        throwFromYouTubeTransportError(error, "playlists");
      }

      throw new YouTubeAPIError(
        YOUTUBE_PLAYLISTS_CLIENT_ERROR_MESSAGE,
        YOUTUBE_ERROR_CODES.API_ERROR,
        500,
      );
    }
  }

  /**
   * Get a specific playlist by ID
   * Requires accessToken for user's own playlists
   */
  async getPlaylist(playlistId: string, accessToken: string): Promise<YouTubePlaylist> {
    // Return mock data when mocking is enabled
    if (shouldMockYouTube()) {
      const mockResponse = this.getMockPlaylist(playlistId);
      const playlist = mockResponse.items?.[0];
      if (!playlist) {
        throw new YouTubeNotFoundError("Playlist");
      }
      return playlist;
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });

    const youtube = google.youtube({
      version: YOUTUBE_API_VERSION,
      auth: oauth2Client,
    });

    try {
      const response = await youtube.playlists.list({
        part: ["snippet", "contentDetails"],
        id: [playlistId],
      });

      // Validate API response with new type-safe architecture
      const validatedResponse = validateYouTubeAPIResponse(
        response.data,
        YouTubePlaylistListResponseSchema,
      );

      if (!validatedResponse.items || validatedResponse.items.length === 0) {
        throw new YouTubeNotFoundError("Playlist");
      }

      const playlist = validatedResponse.items[0];
      if (!playlist) {
        throw new YouTubeNotFoundError("Playlist");
      }
      return playlist;
    } catch (error) {
      console.error("Error fetching YouTube playlist:", error);
      if (error instanceof YouTubeNotFoundError) {
        throw error;
      }
      throw new YouTubeAPIError(
        "Failed to fetch YouTube playlist",
        YOUTUBE_ERROR_CODES.API_ERROR,
        500,
      );
    }
  }

  /**
   * Check which video IDs still exist on YouTube (batch videos.list).
   * Uses the playlist owner's OAuth token so owned private videos are visible.
   * IDs not returned are treated as gone (deleted / others' private / unavailable).
   */
  async checkVideosExist(videoIds: string[], accessToken: string): Promise<Set<string>> {
    const uniqueIds = [...new Set(videoIds.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return new Set();
    }

    if (shouldMockYouTube()) {
      return new Set(uniqueIds);
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });

    const youtube = google.youtube({
      version: YOUTUBE_API_VERSION,
      auth: oauth2Client,
    });

    const existingIds = new Set<string>();

    for (const idChunk of chunkArray(uniqueIds, VIDEOS_LIST_BATCH_SIZE)) {
      const response = await youtube.videos.list({
        part: ["id"],
        id: idChunk,
      });

      const validated = validateYouTubeAPIResponse(
        response.data,
        YouTubeVideoListResponseSchema,
      ) as YouTubeVideoListResponse;

      for (const item of validated.items ?? []) {
        if (item?.id) {
          existingIds.add(item.id);
        }
      }
    }

    return existingIds;
  }

  /**
   * Get playlist items (videos) for a specific playlist
   * Requires accessToken for user's own playlists
   * Handles pagination to fetch all items across multiple pages
   */
  async getPlaylistItems(
    playlistId: string,
    accessToken: string,
    maxResults = 50,
  ): Promise<YouTubePlaylistItem[]> {
    // Return mock data when mocking is enabled
    if (shouldMockYouTube()) {
      const mockResponse = this.getMockPlaylistItems(playlistId, maxResults);
      return mockResponse.items || [];
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });

    const youtube = google.youtube({
      version: YOUTUBE_API_VERSION,
      auth: oauth2Client,
    });

    try {
      const allItems: YouTubePlaylistItem[] = [];
      let nextPageToken: string | undefined = undefined;

      // Loop through all pages until no more nextPageToken
      do {
        const response = await youtube.playlistItems.list({
          part: ["snippet", "contentDetails"],
          playlistId,
          maxResults,
          pageToken: nextPageToken,
        });

        // Validate API response with new type-safe architecture
        const validatedResponse = validateYouTubeAPIResponse(
          response.data,
          YouTubePlaylistItemListResponseSchema,
        ) as YouTubePlaylistItemListResponse;

        // Add items from this page to the accumulated array
        if (validatedResponse.items) {
          allItems.push(...validatedResponse.items);
        }

        // Get nextPageToken for next iteration
        nextPageToken = validatedResponse.nextPageToken;
      } while (nextPageToken);

      return allItems;
    } catch (error) {
      console.error("Error fetching playlist items:", error);

      // Extract more specific error information from YouTube API
      if (error && typeof error === "object" && "response" in error) {
        const apiError = error as {
          response?: {
            data?: {
              error?: {
                code?: number;
                message?: string;
                errors?: Array<{ message?: string; reason?: string }>;
              };
            };
          };
        };
        const errorData = apiError.response?.data?.error;

        if (errorData) {
          throwFromYouTubeGoogleApiError(errorData, "playlistItems");
        }
      }

      rethrowIfYouTubeDomainError(error);

      if (error instanceof Error) {
        throwFromYouTubeTransportError(error, "playlistItems");
      }

      throw new YouTubeAPIError(
        YOUTUBE_PLAYLIST_ITEMS_CLIENT_ERROR_MESSAGE,
        YOUTUBE_ERROR_CODES.API_ERROR,
        500,
      );
    }
  }

  // Mock data methods using mock generators
  private getMockUserPlaylists(): YouTubePlaylist[] {
    // Generate 2 playlists using mock generators
    const playlists = [
      createFakerYouTubePlaylist("PLtest1", {
        title: "Test Playlist 1",
        description: "A test playlist",
        itemCount: 5,
        channelTitle: "Test Channel",
      }),
      createFakerYouTubePlaylist("PLtest2", {
        title: "Test Playlist 2",
        description: "Another test playlist",
        itemCount: 3,
        channelTitle: "Another Channel",
      }),
    ];

    return playlists;
  }

  private getMockPlaylist(playlistId: string): { items: YouTubePlaylist[] } {
    const playlist = createFakerYouTubePlaylist(playlistId, {
      title: "Test Playlist",
      description: "A test playlist",
      itemCount: 5,
      channelTitle: "Test Channel",
    });

    return {
      items: [playlist],
    };
  }

  private getMockPlaylistItems(
    playlistId: string,
    maxResults: number,
  ): { items: YouTubePlaylistItem[] } {
    const items: YouTubePlaylistItem[] = [];
    for (let i = 0; i < Math.min(maxResults, 5); i++) {
      items.push(
        createFakerYouTubePlaylistItem(playlistId, i, {
          title: `Test Video ${i + 1}`,
          artist: "Test Artist",
          videoId: `test-video-${i + 1}`,
        }),
      );
    }
    return { items };
  }
}

/**
 * Create a YouTube service instance
 * API key is optional - OAuth operations don't need it
 */
export function createYouTubeService(): YouTubeService {
  const apiKey = process.env.YOUTUBE_API_KEY;
  return new YouTubeService(apiKey);
}
