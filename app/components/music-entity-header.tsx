import { type ReactNode } from "react";
import { Icon } from "#app/components/ui/icon.tsx";
import { cn } from "#app/utils/misc.tsx";

interface MusicEntityHeaderProps {
  label: string;
  title: string;
  imageUrl?: string | null;
  imageAlt?: string;
  imageShape?: "square" | "circle";
  fallbackIcon?: Parameters<typeof Icon>[0]["name"];
  metadata?: ReactNode;
  description?: string | null;
  className?: string;
}

export function MusicEntityHeader({
  label,
  title,
  imageUrl,
  imageAlt,
  imageShape = "square",
  fallbackIcon = "file-text",
  metadata,
  description,
  className,
}: MusicEntityHeaderProps) {
  const imageClassName =
    imageShape === "circle"
      ? "h-48 w-48 rounded-full object-cover shadow-lg"
      : "h-48 w-48 rounded-md object-cover shadow-lg";
  const placeholderClassName =
    imageShape === "circle"
      ? "flex h-48 w-48 shrink-0 items-center justify-center rounded-full bg-muted shadow-lg"
      : "flex h-48 w-48 shrink-0 items-center justify-center rounded-md bg-muted shadow-lg";

  return (
    <div className={cn("mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-6", className)}>
      {imageUrl ? (
        <img src={imageUrl} alt={imageAlt ?? title} className={imageClassName} />
      ) : (
        <div className={placeholderClassName}>
          <Icon name={fallbackIcon} className="h-16 w-16 text-muted-foreground" />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <h1 className="text-4xl font-bold">{title}</h1>
        {metadata}
        {description ? (
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </div>
  );
}
