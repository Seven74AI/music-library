import { Icon } from "#app/components/ui/icon";
import { Button } from "#app/components/ui/button";

interface NotesBadgeProps {
  count: number;
  onClick: () => void;
}

export function NotesBadge({ count, onClick }: NotesBadgeProps) {
  if (count === 0) return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="h-7 shrink-0 gap-1.5 px-2"
      title={`${count} note${count !== 1 ? "s" : ""}`}
    >
      <Icon name="file-text" className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">{count}</span>
    </Button>
  );
}
