import { type Route } from "./+types/about.ts";

export const meta: Route.MetaFunction = () => [
  { title: "About | Music Library" },
  {
    name: "description",
    content: "Music Library is a personal music library you own.",
  },
];

export default function AboutRoute() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-bold">About Music Library</h1>

      <div className="mt-8 space-y-6 text-sm leading-relaxed">
        <p>
          Music Library is a personal music library you build and control. Import playlists from
          YouTube, upload your own audio, archive tracks for offline playback, and organize
          everything into playlists.
        </p>
        <p>
          Your listening history powers private insights — on-repeat snapshots, heavy rotation, a
          weekly wrap, and a recently played strip — without sharing your data with third parties
          for advertising.
        </p>
        <p>
          Music Library works as an installable app (PWA) with offline playback, so your library is
          available even without a connection.
        </p>
      </div>
    </main>
  );
}
