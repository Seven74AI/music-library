import { useEffect } from "react";
import { Form, Link, useFetcher, useNavigate, useSubmit } from "react-router";
import { Button } from "#app/components/ui/button.tsx";
import { hasReadyKaraokeVersion } from "#app/features/track-video/karaoke-ready.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { type Route } from "./+types/karaoke.ts";

export const KARAOKE_LANGUAGES = ["all", "en", "fr"] as const;
export const KARAOKE_STATUSES = ["all", "ready", "draft"] as const;
type KaraokeLanguage = (typeof KARAOKE_LANGUAGES)[number];
type KaraokeStatus = (typeof KARAOKE_STATUSES)[number];

function parseFilter<T extends string>(raw: string | null, allowed: readonly T[]): T {
  return allowed.includes(raw as T) ? (raw as T) : allowed[0]!;
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireUserId(request);
  const url = new URL(request.url);
  const language: KaraokeLanguage = parseFilter(url.searchParams.get("language"), KARAOKE_LANGUAGES);
  const status: KaraokeStatus = parseFilter(url.searchParams.get("status"), KARAOKE_STATUSES);

  // Filters apply to the CURRENT version only; no current version never matches a filter.
  const versionWhere = {
    ...(language !== "all" ? { language } : {}),
    ...(status !== "all" ? { status } : {}),
  };
  const filtered = Object.keys(versionWhere).length > 0;

  const rows = await prisma.trackKaraoke.findMany({
    where: filtered ? { currentVersion: { is: versionWhere } } : {},
    orderBy: { updatedAt: "desc" },
    select: {
      trackId: true,
      track: { select: { title: true, artist: { select: { name: true } } } },
      currentVersion: { select: { language: true, status: true, videoFileId: true } },
    },
  });

  const items = rows.map((row) => ({
    trackId: row.trackId,
    title: row.track.title,
    artist: row.track.artist.name,
    language: row.currentVersion?.language ?? null,
    status: row.currentVersion?.status ?? null,
    canStart: hasReadyKaraokeVersion(row.currentVersion),
  }));
  return { items, language, status };
}

function StartRoomButton({ trackId, disabled }: { trackId: string; disabled: boolean }) {
  const fetcher = useFetcher<{ success: boolean; code?: string; error?: string }>();
  const navigate = useNavigate();
  const code = fetcher.data?.success ? fetcher.data.code : undefined;
  useEffect(() => {
    if (code) void navigate(`/rooms/${code}`);
  }, [code, navigate]);
  return (
    <div className="flex flex-col items-end gap-1">
      <fetcher.Form method="POST" action="/resources/karaoke/start-room">
        <input type="hidden" name="trackId" value={trackId} />
        <Button type="submit" size="sm" disabled={disabled || fetcher.state !== "idle"}>
          Start room
        </Button>
      </fetcher.Form>
      {fetcher.data && !fetcher.data.success ? (
        <p role="alert" className="text-destructive text-xs">
          {fetcher.data.error}
        </p>
      ) : null}
    </div>
  );
}

export default function KaraokePage({ loaderData }: Route.ComponentProps) {
  const { items, language, status } = loaderData;
  const submit = useSubmit();
  return (
    <div className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 text-2xl font-semibold">Karaoke</h1>
      <Form
        method="GET"
        className="mb-4 flex gap-4"
        onChange={(e) => void submit(e.currentTarget)}
      >
        <label className="flex items-center gap-2 text-sm">
          Language
          <select name="language" defaultValue={language} className="rounded border px-2 py-1">
            {KARAOKE_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          Status
          <select name="status" defaultValue={status} className="rounded border px-2 py-1">
            {KARAOKE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </Form>
      {items.length === 0 ? (
        <p className="text-muted-foreground">No karaoke tracks match.</p>
      ) : (
        <ul className="divide-y">
          {items.map((item) => (
            <li key={item.trackId} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <Link to={`/library/${item.trackId}`} className="block truncate font-medium">
                  {item.title}
                </Link>
                <p className="text-muted-foreground truncate text-sm">{item.artist}</p>
              </div>
              <span className="rounded border px-2 py-0.5 text-xs">{item.status ?? "—"}</span>
              <StartRoomButton trackId={item.trackId} disabled={!item.canStart} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
