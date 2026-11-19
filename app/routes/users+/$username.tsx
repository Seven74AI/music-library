import { invariantResponse } from "@epic-web/invariant";
import { Img } from "openimg/react";
import { type LoaderFunctionArgs, Form, Link, useLoaderData } from "react-router";
import { GeneralErrorBoundary } from "#app/components/error-boundary.tsx";
import { HomeRecentTrackCard } from "#app/components/home/home-recent-track-card.tsx";
import { Spacer } from "#app/components/spacer.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import {
  getHeavyRotationTracks,
  getProfileStats,
  getTopArtists,
  getTopTracks,
} from "#app/features/listening-insights/index.server.ts";
import { getRecentlyPlayedTracks } from "#app/features/recently-played/recently-played.server.ts";
import { getUserIdOrNull } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { getProfilePrivacy } from "#app/utils/profile-privacy.server.ts";
import { getUserImgSrc } from "#app/utils/misc.tsx";
import { isPlayableTrack } from "#app/utils/playable-track.ts";
import { useOptionalUser } from "#app/utils/user.ts";
import { type Route } from "./+types/$username.ts";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const user = await prisma.user.findFirst({
    select: {
      id: true,
      name: true,
      username: true,
      createdAt: true,
      image: { select: { id: true, objectKey: true } },
    },
    where: {
      username: params.username,
    },
  });

  invariantResponse(user, "User not found", { status: 404 });

  // Privacy is enforced at data time: a block whose toggle is off is never
  // computed and its key is omitted from the returned object entirely.
  const privacy = await getProfilePrivacy(user.id);
  const viewerId = await getUserIdOrNull(request);
  const isOwner = viewerId === user.id;

  const [topTracks, topArtists, totals, heavyRotation, recentlyPlayed] = await Promise.all([
    privacy.showTopTracks ? getTopTracks({ userId: user.id }) : undefined,
    privacy.showTopArtists ? getTopArtists({ userId: user.id }) : undefined,
    privacy.showTotals ? getProfileStats({ userId: user.id }) : undefined,
    privacy.showHeavyRotation
      ? getHeavyRotationTracks({ userId: user.id, window: "month", limit: 10 })
      : undefined,
    privacy.showRecentlyPlayed ? getRecentlyPlayedTracks({ userId: user.id, limit: 10 }) : undefined,
  ]);

  return {
    user,
    userJoinedDisplay: user.createdAt.toLocaleDateString(),
    ...(topTracks ? { topTracks } : {}),
    ...(topArtists ? { topArtists } : {}),
    ...(totals ? { totals } : {}),
    ...(heavyRotation ? { heavyRotation } : {}),
    ...(recentlyPlayed ? { recentlyPlayed } : {}),
    // Only the owner learns which blocks are hidden (for the placeholder).
    ...(isOwner
      ? {
          hiddenBlocks: {
            topTracks: !privacy.showTopTracks,
            topArtists: !privacy.showTopArtists,
            totals: !privacy.showTotals,
            heavyRotation: !privacy.showHeavyRotation,
            recentlyPlayed: !privacy.showRecentlyPlayed,
          },
        }
      : {}),
  };
}

function formatListeningTime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function HiddenPlaceholder({ label }: { label: string }) {
  return (
    <section className="text-muted-foreground w-full rounded-2xl border border-dashed p-4 text-center text-sm">
      {label}: hidden from visitors
    </section>
  );
}

type CardTrack = Parameters<typeof HomeRecentTrackCard>[0]["track"];

/**
 * Profile-specific grid of track cards. Deliberately not the hub strips: those
 * link to owner-gated pages ("View history") that are wrong on a public profile.
 * Playback stays owner-gated server-side; visitors see the same cards.
 */
function TrackCardGrid({ tracks }: { tracks: CardTrack[] }) {
  const playableTracks = tracks.filter(isPlayableTrack);
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {tracks.map((track, index) => (
        // HomeRecentTrackCard hardcodes a strip width; force it to fill the grid cell.
        <li key={track.id} className="[&>button]:w-full">
          <HomeRecentTrackCard track={track} index={index} playableTracks={playableTracks} />
        </li>
      ))}
    </ul>
  );
}

const cardClassName = "bg-muted rounded-3xl p-6";

export default function ProfileRoute() {
  const data = useLoaderData<typeof loader>();
  const user = data.user;
  const userDisplayName = user.name ?? user.username;
  const loggedInUser = useOptionalUser();
  const isLoggedInUser = user.id === loggedInUser?.id;

  return (
    <div className="container mt-36 mb-48 flex flex-col items-center justify-center">
      <Spacer size="4xs" />

      <div className="bg-muted container flex flex-col items-center rounded-3xl p-12">
        <div className="relative w-52">
          <div className="absolute -top-40">
            <div className="relative">
              <Img
                src={getUserImgSrc(data.user.image?.objectKey)}
                alt={userDisplayName}
                className="size-52 rounded-full object-cover"
                width={832}
                height={832}
              />
            </div>
          </div>
        </div>

        <Spacer size="sm" />

        <div className="flex w-full flex-col items-center">
          <div className="flex flex-wrap items-center justify-center gap-4">
            <h1 className="text-h2 text-center">{userDisplayName}</h1>
          </div>
          <p className="text-muted-foreground mt-2 text-center">Joined {data.userJoinedDisplay}</p>

          {data.totals &&
          (data.totals.plays > 0 ||
            data.totals.librarySize > 0 ||
            data.totals.listeningTimeSeconds > 0) ? (
            <dl className="mt-6 flex flex-wrap justify-center gap-8">
              <div className="text-center">
                <dt className="text-muted-foreground text-sm">Completed plays</dt>
                <dd className="text-h3">{data.totals.plays}</dd>
              </div>
              <div className="text-center">
                <dt className="text-muted-foreground text-sm">Library size</dt>
                <dd className="text-h3">{data.totals.librarySize}</dd>
              </div>
              <div className="text-center">
                <dt className="text-muted-foreground text-sm">Listening time</dt>
                <dd className="text-h3">{formatListeningTime(data.totals.listeningTimeSeconds)}</dd>
              </div>
            </dl>
          ) : data.hiddenBlocks?.totals ? (
            <div className="mt-6 w-full max-w-md">
              <HiddenPlaceholder label="Totals" />
            </div>
          ) : null}

          {isLoggedInUser && (
            <Form action="/logout" method="POST" className="mt-3">
              <Button type="submit" variant="link" size="pill">
                <Icon name="exit" className="scale-125 max-md:scale-150">
                  Logout
                </Icon>
              </Button>
            </Form>
          )}
          {isLoggedInUser && (
            <div className="mt-10 flex gap-4">
              <Button asChild>
                <Link to="/settings/profile" prefetch="intent">
                  Edit profile
                </Link>
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-10 grid w-full grid-cols-1 gap-8 md:grid-cols-2">
        {data.topTracks && data.topTracks.length > 0 ? (
          <section aria-labelledby="top-tracks-heading" className={cardClassName}>
            <h2 id="top-tracks-heading" className="text-h4 mb-3">
              Top tracks
            </h2>
            <ol className="flex flex-col gap-2">
              {data.topTracks.map((row, index) => (
                <li key={row.track.id} className="flex items-baseline gap-3">
                  <span className="text-muted-foreground w-6 text-right">{index + 1}</span>
                  <span className="font-medium">{row.track.title}</span>
                  <span className="text-muted-foreground">{row.track.artist.name}</span>
                  <span className="text-muted-foreground ml-auto">
                    {row.count} {row.count === 1 ? "play" : "plays"}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ) : data.hiddenBlocks?.topTracks ? (
          <HiddenPlaceholder label="Top tracks" />
        ) : null}

        {data.topArtists && data.topArtists.length > 0 ? (
          <section aria-labelledby="top-artists-heading" className={cardClassName}>
            <h2 id="top-artists-heading" className="text-h4 mb-3">
              Top artists
            </h2>
            <ol className="flex flex-col gap-2">
              {data.topArtists.map((row, index) => (
                <li key={row.artist.id} className="flex items-baseline gap-3">
                  <span className="text-muted-foreground w-6 text-right">{index + 1}</span>
                  <span className="font-medium">{row.artist.name}</span>
                  <span className="text-muted-foreground ml-auto">
                    {row.count} {row.count === 1 ? "play" : "plays"}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ) : data.hiddenBlocks?.topArtists ? (
          <HiddenPlaceholder label="Top artists" />
        ) : null}

        {data.heavyRotation && data.heavyRotation.length > 0 ? (
          <section aria-labelledby="heavy-rotation-heading" className={cardClassName}>
            <h2 id="heavy-rotation-heading" className="text-h4 mb-3">
              Heavy rotation
            </h2>
            <TrackCardGrid tracks={data.heavyRotation.map((item) => item.track as CardTrack)} />
          </section>
        ) : data.hiddenBlocks?.heavyRotation ? (
          <HiddenPlaceholder label="Heavy rotation" />
        ) : null}

        {data.recentlyPlayed && data.recentlyPlayed.length > 0 ? (
          <section aria-labelledby="recently-played-heading" className={cardClassName}>
            <h2 id="recently-played-heading" className="text-h4 mb-3">
              Recently played
            </h2>
            <TrackCardGrid tracks={data.recentlyPlayed.map((item) => item.track as CardTrack)} />
          </section>
        ) : data.hiddenBlocks?.recentlyPlayed ? (
          <HiddenPlaceholder label="Recently played" />
        ) : null}
      </div>
    </div>
  );
}

export const meta: Route.MetaFunction = ({ loaderData, params }) => {
  const displayName = loaderData?.user.name ?? params.username;
  return [
    { title: `${displayName} | Music Library` },
    {
      name: "description",
      content: `Profile of ${displayName} on Music Library`,
    },
  ];
};

function UserNotFound404({
  params,
}: {
  error: { data?: unknown };
  params: Record<string, string | undefined>;
}) {
  return <p>No user with the username "{params.username}" exists</p>;
}

export function ErrorBoundary() {
  return <GeneralErrorBoundary statusHandlers={{ 404: UserNotFound404 }} />;
}
