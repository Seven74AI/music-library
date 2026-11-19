import { prisma } from "#app/utils/db.server.ts";

export type ProfilePrivacySettings = {
  showTopTracks: boolean;
  showTopArtists: boolean;
  showTotals: boolean;
  showHeavyRotation: boolean;
  showRecentlyPlayed: boolean;
  showPlaylists: boolean;
};

/** Public by default: a missing `ProfilePrivacy` row means every block is visible. */
export const DEFAULT_PROFILE_PRIVACY: ProfilePrivacySettings = {
  showTopTracks: true,
  showTopArtists: true,
  showTotals: true,
  showHeavyRotation: true,
  showRecentlyPlayed: true,
  showPlaylists: true,
};

export async function getProfilePrivacy(userId: string): Promise<ProfilePrivacySettings> {
  const row = await prisma.profilePrivacy.findUnique({
    where: { userId },
    select: {
      showTopTracks: true,
      showTopArtists: true,
      showTotals: true,
      showHeavyRotation: true,
      showRecentlyPlayed: true,
      showPlaylists: true,
    },
  });
  return row ?? { ...DEFAULT_PROFILE_PRIVACY };
}
