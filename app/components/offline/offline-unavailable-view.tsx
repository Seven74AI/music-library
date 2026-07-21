import { Link } from "react-router";
import { Button } from "#app/components/ui/button.tsx";
import { Icon } from "#app/components/ui/icon.tsx";

type OfflineUnavailableViewProps = {
  title?: string;
  description?: string;
};

export function OfflineUnavailableView({
  title = "You're offline",
  description = "This page needs a network connection. Open Downloads to play music you saved for offline listening.",
}: OfflineUnavailableViewProps) {
  return (
    <div className="mx-auto max-w-lg text-center">
      <Icon name="download" className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground mt-3">{description}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link to="/downloads">Open downloads</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/library">Offline library</Link>
        </Button>
      </div>
    </div>
  );
}
