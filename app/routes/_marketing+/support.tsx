import { type Route } from "./+types/support.ts";

export const meta: Route.MetaFunction = () => [
  { title: "Support | Music Library" },
  {
    name: "description",
    content: "How to use Music Library. Support is handled by the library operator.",
  },
];

export default function SupportRoute() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-bold">Support</h1>

      <div className="mt-8 space-y-6 text-sm leading-relaxed">
        <p>
          Support is handled by the library operator. Music Library does not publish a public
          contact address, and this page does not promise a reply.
        </p>

        <section>
          <h2 className="text-lg font-semibold">Getting started</h2>
          <p className="mt-2">
            You can read this page without an account. Sign up, then sign in, to build a library,
            connect YouTube, and download tracks for offline playback.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Connecting YouTube</h2>
          <p className="mt-2">
            After you sign in, connect your YouTube account from the services page to sync playlists
            into your library. A synced video can be played once its audio has been archived.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Offline playback</h2>
          <p className="mt-2">
            While you are signed in, download tracks or playlists from their menus to play them
            offline. Manage downloads, including auto-cached queue tracks, from the Downloads page.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Account &amp; data</h2>
          <p className="mt-2">
            Change your email or password from Settings. To delete your account, use Delete all your
            data in your profile settings.
          </p>
        </section>
      </div>
    </main>
  );
}
