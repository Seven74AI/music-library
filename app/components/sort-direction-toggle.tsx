import { Button } from "#app/components/ui/button.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { cn } from "#app/utils/misc.tsx";
import { oppositeSortDirection, type SortDirection } from "#app/utils/sort-direction.ts";

type SortDirectionToggleProps = {
  value: SortDirection;
  onValueChange: (direction: SortDirection) => void;
  disabled?: boolean;
  className?: string;
  /** Accessible name for the toggle button. */
  "aria-label"?: string;
};

/**
 * Compact asc/desc toggle used next to sort field selects.
 */
export function SortDirectionToggle({
  value,
  onValueChange,
  disabled = false,
  className,
  "aria-label": ariaLabel = "Sort direction",
}: SortDirectionToggleProps) {
  const next = oppositeSortDirection(value);
  const label = value === "asc" ? "Ascending" : "Descending";

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={cn("shrink-0 text-foreground", className)}
      disabled={disabled}
      aria-label={`${ariaLabel}: ${label}. Click for ${next === "asc" ? "ascending" : "descending"}`}
      title={label}
      onClick={() => onValueChange(next)}
    >
      <Icon name={value === "asc" ? "chevron-up" : "chevron-down"} className="h-4 w-4" />
      <span className="sr-only">{label}</span>
    </Button>
  );
}
