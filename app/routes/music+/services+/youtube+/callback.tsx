import { redirect, type LoaderFunctionArgs } from "react-router";
import { YOUTUBE_SERVICE } from "#app/constants/services";
import {
  recordSecurityEvent,
  SECURITY_EVENT_TYPES,
} from "#app/features/security/track-event.server.ts";
import { requireUserId } from "#app/utils/auth.server";
import { prisma } from "#app/utils/db.server";
import { encryptConnectionTokens } from "#app/utils/token-cipher.server.ts";
import { createYouTubeOAuthService } from "#app/utils/youtube-oauth.server";
import { createYouTubeService } from "#app/utils/youtube.server";

export async function loader({ request, url }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);

  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    // Handle OAuth error
    return redirect("/music/services/youtube/auth?error=oauth_failed");
  }

  if (!code) {
    // No code parameter, redirect to auth
    return redirect("/music/services/youtube/auth");
  }

  try {
    const youtubeOAuthService = createYouTubeOAuthService();

    // Exchange code for tokens
    const tokens = await youtubeOAuthService.getTokens(code);

    // Resolve the YouTube channel id to use as the stable provider id.
    // The Connection table's unique key is [providerName, providerId]; keying
    // every connection on a constant collides across users, so the second user
    // to connect overwrites the first user's tokens (and still shows as
    // disconnected). Using the channel id keeps each connection distinct.
    const userInfo = await createYouTubeService().getYouTubeUserInfo(tokens.access_token);

    const existing = await prisma.connection.findUnique({
      where: {
        providerName_providerId: {
          providerName: YOUTUBE_SERVICE.NAME,
          providerId: userInfo.id,
        },
      },
      select: { userId: true },
    });

    if (existing && existing.userId !== userId) {
      return redirect("/music/services/youtube/auth?error=already_connected");
    }

    // Store tokens for the user
    const sealedTokens = encryptConnectionTokens(JSON.stringify(tokens));
    await prisma.connection.upsert({
      where: {
        providerName_providerId: {
          providerName: YOUTUBE_SERVICE.NAME,
          providerId: userInfo.id,
        },
      },
      update: {
        tokens: sealedTokens,
      },
      create: {
        userId,
        providerName: YOUTUBE_SERVICE.NAME,
        providerId: userInfo.id,
        tokens: sealedTokens,
      },
    });

    await recordSecurityEvent({
      request,
      eventType: SECURITY_EVENT_TYPES.serviceConnected,
      userId,
      perpetual: false,
      metadata: {
        provider: YOUTUBE_SERVICE.NAME,
        reconnected: Boolean(existing),
      },
    });

    // Success - redirect to YouTube service page
    return redirect("/music/services/youtube?connected=true");
  } catch (callbackError) {
    console.error("YouTube OAuth callback error:", callbackError);
    return redirect("/music/services/youtube/auth?error=callback_failed");
  }
}
