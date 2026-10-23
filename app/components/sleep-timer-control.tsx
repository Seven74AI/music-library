import { Button } from "#app/components/ui/button";
import { Icon } from "#app/components/ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "#app/components/ui/popover";
import { cn } from "#app/utils/misc";
import { SLEEP_TIMER_PRESETS_MINUTES } from "#app/utils/sleep-timer.ts";

export const SLEEP_TIMER_MENU_ATTR = "data-sleep-timer-menu";

export function isSleepTimerMenuTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(`[${SLEEP_TIMER_MENU_ATTR}]`));
}

export function SleepTimerControl({
  sleepTimerLabel,
  onStart,
  onClear,
  triggerClassName = "h-8 px-2",
}: {
  sleepTimerLabel: string | null;
  onStart: (minutes: number) => void;
  onClear: () => void;
  triggerClassName?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(triggerClassName, sleepTimerLabel ? "text-primary bg-primary/10" : "")}
          aria-label="Sleep timer"
          title="Sleep timer"
        >
          <Icon name="moon" className="h-4 w-4" />
          {sleepTimerLabel ? (
            <span className="ml-1 text-xs tabular-nums">{sleepTimerLabel}</span>
          ) : null}
        </Button>
      </PopoverTrigger>
      {/* Toast viewport is z-100 so Undo stays above dialogs. This menu has to
          paint above that toast; otherwise "Sleep timer set" covers Cancel.
          pointer-events is set inline because the now-playing sheet writes
          pointer-events: none on document.body, and a portaled menu inherits it. */}
      <PopoverContent
        align="end"
        className="z-[110] w-56 space-y-3"
        style={{ pointerEvents: "auto" }}
        data-sleep-timer-menu=""
      >
        <div>
          <p className="text-sm font-medium">Sleep timer</p>
          <p className="text-xs text-muted-foreground">Stop playback after the selected time.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {SLEEP_TIMER_PRESETS_MINUTES.map((minutes) => (
            <Button
              key={minutes}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onStart(minutes)}
            >
              {minutes} min
            </Button>
          ))}
        </div>
        {sleepTimerLabel ? (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            Cancel timer
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
