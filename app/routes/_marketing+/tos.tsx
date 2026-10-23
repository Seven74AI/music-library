import { type Route } from "./+types/tos.ts";

export const meta: Route.MetaFunction = () => [
  { title: "Terms of Service | Music Library" },
  {
    name: "description",
    content: "The terms that govern your use of Music Library.",
  },
];

export default function TermsOfServiceRoute() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-bold">Terms of Service</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: October 2026</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold">Acceptance</h2>
          <p className="mt-2">
            By creating an account you agree to these terms. If you do not agree, do not use the
            service.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Your content</h2>
          <p className="mt-2">
            You retain rights to the music metadata and playlists you create. You are responsible
            for ensuring that any content you upload (including YouTube cookies and audio files) is
            content you are authorized to use.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Acceptable use</h2>
          <p className="mt-2">
            Do not use the service to infringe copyright, circumvent access controls, or engage in
            unlawful activity. We may suspend accounts that violate these terms.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Availability</h2>
          <p className="mt-2">
            The service is provided "as is" and may change or be discontinued. We are not liable for
            data loss beyond what is required by law.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Changes</h2>
          <p className="mt-2">We may update these terms; material changes will be posted here.</p>
        </section>
      </div>
    </main>
  );
}
