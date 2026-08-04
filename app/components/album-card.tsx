import { Link } from "react-router";
import { Icon } from "#app/components/ui/icon.tsx";

interface AlbumCardProps {
  id: string;
  name: string;
  year?: number | null;
  trackCount: number;
  coverObjectKey?: string | null;
}

export function AlbumCard({ id, name, year, trackCount, coverObjectKey }: AlbumCardProps) {
  return (
    <Link to={`/albums/${id}`} className="group rounded-lg p-3 transition-colors hover:bg-muted/50">
      {coverObjectKey ? (
        <img
          src={`/resources/images/${coverObjectKey}`}
          alt={name}
          className="mb-2 aspect-square w-full rounded-md object-cover shadow-sm"
          loading="lazy"
        />
      ) : (
        <div className="mb-2 flex aspect-square w-full items-center justify-center rounded-md bg-muted shadow-sm">
          <Icon name="camera" className="h-10 w-10 text-muted-foreground" />
        </div>
      )}
      <p className="truncate text-sm font-medium group-hover:underline">{name}</p>
      <p className="truncate text-xs text-muted-foreground">
        {year ?? "—"} · {trackCount} track{trackCount !== 1 ? "s" : ""}
      </p>
    </Link>
  );
}
