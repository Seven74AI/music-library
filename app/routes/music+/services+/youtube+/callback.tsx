import { redirect, type LoaderFunctionArgs } from "react-router";
import { YOUTUBE_SERVICE } from "#app/constants/services";
import { requireUserId } from "#app/utils/auth.server";
import { prisma } from "#app/utils/db.server";
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

    // Store tokens for the user
    await prisma.connection.upsert({
      where: {
        providerName_providerId: {
          providerName: YOUTUBE_SERVICE.NAME,
          providerId: userInfo.id,
        },
      },
      update: {
        userId,
        tokens: JSON.stringify(tokens),
      },
      create: {
        userId,
        providerName: YOUTUBE_SERVICE.NAME,
        providerId: userInfo.id,
        tokens: JSON.stringify(tokens),
      },
    });

    // Success - redirect to YouTube service page
    return redirect("/music/services/youtube?connected=true");
  } catch (error) {
    console.error("YouTube OAuth callback error:", error);
    return redirect("/music/services/youtube/auth?error=callback_failed");
  }
}
