// Decision 34: there is no Music Hub. `music.tsx` is only a layout, so without
// an index route GET /music renders an empty outlet with HTTP 200. This index
// throws 404 for the bare URL. Child routes such as /music/services do not
// match it.

import { Link, useLocation } from "react-router";
import { GeneralErrorBoundary } from "#app/components/error-boundary.tsx";
import { Icon } from "#app/components/ui/icon.tsx";

export function loader() {
  throw new Response("Not found", { status: 404 });
}

export default function MusicIndex() {
  return <NotFound />;
}

function NotFound() {
  const location = useLocation();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h1>We can't find this page:</h1>
        <pre className="text-body-lg break-all whitespace-pre-wrap">{location.pathname}</pre>
      </div>
      <Link to="/" className="text-body-md underline">
        <Icon name="arrow-left">Back</Icon>
      </Link>
    </div>
  );
}

export function ErrorBoundary() {
  return <GeneralErrorBoundary statusHandlers={{ 404: NotFound }} />;
}
