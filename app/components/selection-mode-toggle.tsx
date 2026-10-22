import { useSelectionMode } from "#app/features/curator/selection.ts";
import { Button } from "#app/components/ui/button";
import { Icon } from "#app/components/ui/icon";
import { Label } from "#app/components/ui/label";
import { Switch } from "#app/components/ui/switch";

interface SelectionModeToggleProps {
  variant?: "button" | "switch";
  className?: string;
}

/**
 * Toggle component for curator selection mode
 * Can be rendered as a button or switch
 */
export function SelectionModeToggle({ variant = "switch", className }: SelectionModeToggleProps) {
  const { selectionMode, toggleSelectionMode } = useSelectionMode();

  if (variant === "button") {
    return (
      <Button
        variant={selectionMode ? "default" : "outline"}
        size="sm"
        onClick={toggleSelectionMode}
        className={className}
      >
        <Icon name={selectionMode ? "check" : "check-circled"} className="h-4 w-4 mr-2" />
        Selection Mode {selectionMode ? "On" : "Off"}
      </Button>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className || ""}`}>
      <Switch
        id="selection-mode"
        checked={selectionMode}
        onCheckedChange={toggleSelectionMode}
        aria-label="Toggle selection mode"
      />
      <Label htmlFor="selection-mode" className="text-sm font-normal cursor-pointer">
        Selection Mode
      </Label>
    </div>
  );
}
