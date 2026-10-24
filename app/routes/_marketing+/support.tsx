import { type Route } from "./+types/support.ts";

export const meta: Route.MetaFunction = () => [
  { title: "Support | Music Library" },
  {
    name: "description",
    content: "Get help with Music Library.",
  },
];

export default function SupportRoute() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-bold">Support</h1>

      <div className="mt-8 space-y-6 text-sm leading-relaxed">
        <p>
          Need help with Music Library? Check the common questions below, or reach out and we'll get
          back to you.
        </p>

        <section>
          <h2 className="text-lg font-semibold">Connecting YouTube</h2>
          <p className="mt-2">
            Connect your YouTube account from the services page to sync playlists into your library.
            If archiving audio fails with an authentication error, re-upload a fresh cookies file
            from the admin audio queue.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Offline playback</h2>
          <p className="mt-2">
            Download tracks or playlists from their menus to play them offline. Manage downloads,
            including auto-cached queue tracks, from the Downloads page.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Account &amp; data</h2>
          <p className="mt-2">
            Change your email or password from Settings. To delete your account, use the option in
            your profile settings.
          </p>
        </section>
      </div>
    </main>
  );
}
