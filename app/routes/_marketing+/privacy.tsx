import { type Route } from "./+types/privacy.ts";

export const meta: Route.MetaFunction = () => [
  { title: "Privacy Policy | Music Library" },
  {
    name: "description",
    content: "How Music Library collects, stores, and uses your data.",
  },
];

export default function PrivacyRoute() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-bold">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: October 2026</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold">What we store</h2>
          <p className="mt-2">
            Music Library stores the account information you provide at sign-up (email, username,
            and name), your personal library, playlists, and listening history. If you connect a
            YouTube account, we store the OAuth tokens needed to sync your playlists and the
            playback cookies you optionally upload to enable audio archiving.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">How your data is used</h2>
          <p className="mt-2">
            Your data powers the product: building your library, syncing playlists, generating
            listening insights (on-repeat snapshots, heavy rotation, weekly wrap), and surfacing
            recently played tracks. We do not sell your data and do not share it with third parties
            for advertising.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Audio and covers</h2>
          <p className="mt-2">
            Archived audio files and cover images are stored in object storage and served back to
            your own devices. Uploaded YouTube cookies are stored server-side and used only to fetch
            audio for your library.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Deleting your data</h2>
          <p className="mt-2">
            You can delete tracks, playlists, and your account from within the app. Deleting your
            account removes your account data, library, and playlists.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Contact</h2>
          <p className="mt-2">Questions about this policy? Reach out through the Support page.</p>
        </section>
      </div>
    </main>
  );
}
