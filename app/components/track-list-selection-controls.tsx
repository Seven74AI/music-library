import { Button } from "#app/components/ui/button";
import { Checkbox } from "#app/components/ui/checkbox";

interface TrackListSelectionControlsProps {
  selectedCount: number;
  totalCount: number;
  allSelected: boolean;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onBulkEdit: () => void;
  isCurator: boolean;
}

export function TrackListSelectionControls({
  selectedCount,
  totalCount,
  allSelected,
  onSelectAll,
  onDeselectAll,
  onBulkEdit,
  isCurator,
}: TrackListSelectionControlsProps) {
  if (!isCurator) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 py-3 px-4 bg-muted/50 rounded-lg border mb-4">
      <Checkbox
        checked={allSelected && totalCount > 0}
        onCheckedChange={(checked) => {
          if (checked) {
            onSelectAll();
          } else {
            onDeselectAll();
          }
        }}
        aria-label={allSelected ? "Deselect all tracks" : "Select all tracks"}
      />

      <div className="flex items-center gap-2 flex-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onSelectAll}
          disabled={allSelected && totalCount > 0}
        >
          Select All
        </Button>
        <Button variant="ghost" size="sm" onClick={onDeselectAll} disabled={selectedCount === 0}>
          Deselect All
        </Button>

        {selectedCount > 0 && (
          <span className="text-sm text-muted-foreground">
            {selectedCount} track{selectedCount === 1 ? "" : "s"} selected
          </span>
        )}
      </div>

      {selectedCount >= 2 && (
        <Button onClick={onBulkEdit} size="sm">
          Bulk Edit
        </Button>
      )}
    </div>
  );
}
