import { YOUTUBE_SERVICE } from "#app/constants/services";
import { type YouTubeTokenData } from "#app/types/youtube";
import { prisma } from "#app/utils/db.server";
import {
  decryptConnectionTokens,
  encryptConnectionTokens,
} from "#app/utils/token-cipher.server.ts";
import { shouldMockYouTube } from "#app/utils/youtube-mock-utils";
import { createYouTubeOAuthService } from "#app/utils/youtube-oauth.server";

export type ServiceAccessToken = { access_token: string };

/**
 * Resolve a valid OAuth access token for an external service.
 * Refreshes expired tokens when a refresh token is available.
 *
 * @returns `{ access_token }` or `null` when no valid connection exists
 */
export async function resolveServiceAccessToken(
  serviceName: string,
  userId: string,
): Promise<ServiceAccessToken | null> {
  try {
    if (serviceName === YOUTUBE_SERVICE.NAME) {
      return resolveYouTubeAccessToken(userId);
    }

    return null;
  } catch (error) {
    console.error(`Error resolving access token for ${serviceName}:`, error);
    return null;
  }
}

/**
 * Check whether a user has a valid service connection.
 */
export async function hasServiceConnection(serviceName: string, userId: string): Promise<boolean> {
  const token = await resolveServiceAccessToken(serviceName, userId);
  return token !== null;
}

/**
 * Disconnect a user's OAuth link to an external service.
 *
 * @returns true when a connection row was deleted
 */
export async function disconnectServiceConnection(
  serviceName: string,
  userId: string,
): Promise<boolean> {
  try {
    const result = await prisma.connection.deleteMany({
      where: {
        providerName: serviceName,
        userId,
      },
    });
    return result.count > 0;
  } catch (error) {
    console.error(`Error disconnecting ${serviceName}:`, error);
    return false;
  }
}

/**
 * Single-flight map for OAuth token refreshes, keyed by connection id.
 * Coalesces concurrent refresh attempts for the same connection into one
 * refresh call + one DB write, preventing duplicate refresh calls, a
 * last-write-wins race on `connection.tokens`, and refresh-token invalidation
 * with rotating-token providers.
 */
const inFlightRefreshes = new Map<string, Promise<ServiceAccessToken | null>>();

async function resolveYouTubeAccessToken(userId: string): Promise<ServiceAccessToken | null> {
  const connection = await prisma.connection.findFirst({
    where: {
      providerName: YOUTUBE_SERVICE.NAME,
      userId,
    },
  });

  if (!connection?.tokens) {
    return null;
  }

  let tokenJson: string;
  try {
    tokenJson = decryptConnectionTokens(connection.tokens);
  } catch {
    console.error("Failed to decrypt YouTube OAuth tokens");
    return null;
  }

  let tokenData: YouTubeTokenData;
  try {
    tokenData = JSON.parse(tokenJson) as YouTubeTokenData;
  } catch {
    console.error("Invalid YouTube OAuth token format");
    return null;
  }

  if (!tokenData.access_token) {
    return null;
  }

  if (shouldMockYouTube()) {
    return { access_token: tokenData.access_token };
  }

  const isExpired = tokenData.expiry_date !== undefined && tokenData.expiry_date < Date.now();

  if (!isExpired) {
    return { access_token: tokenData.access_token };
  }

  if (!tokenData.refresh_token) {
    console.log("No refresh token available, user needs to re-authenticate");
    return null;
  }

  // Reuse an in-flight refresh for this connection instead of starting a second
  // one. The second caller waits on the same promise and receives the same
  // refreshed token, so the provider is only hit once and `connection.tokens`
  // is only written once.
  const inFlight = inFlightRefreshes.get(connection.id);
  if (inFlight) {
    return inFlight;
  }

  const refreshPromise = refreshYouTubeAccessToken(
    connection.id,
    tokenData.refresh_token,
    tokenData,
  ).finally(() => {
    inFlightRefreshes.delete(connection.id);
  });
  inFlightRefreshes.set(connection.id, refreshPromise);
  return refreshPromise;
}

async function refreshYouTubeAccessToken(
  connectionId: string,
  refreshToken: string,
  tokenData: YouTubeTokenData,
): Promise<ServiceAccessToken | null> {
  try {
    console.log("YouTube OAuth token has expired, attempting refresh...");
    const oauthService = createYouTubeOAuthService();
    const refreshedTokens = await oauthService.refreshAccessToken(refreshToken);

    const updatedTokenData: YouTubeTokenData = {
      ...tokenData,
      access_token: refreshedTokens.access_token,
      expiry_date: refreshedTokens.expiry_date,
    };

    await prisma.connection.update({
      where: { id: connectionId },
      data: { tokens: encryptConnectionTokens(JSON.stringify(updatedTokenData)) },
    });

    console.log("YouTube OAuth token refreshed successfully");

    return { access_token: updatedTokenData.access_token };
  } catch (refreshError) {
    console.error("Failed to refresh YouTube OAuth token:", refreshError);
    return null;
  }
}
