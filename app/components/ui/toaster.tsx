import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastIcon,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "#app/components/ui/toast.tsx";
import { useToast } from "#app/components/ui/use-toast.ts";
import { cn } from "#app/utils/misc.tsx";

/**
 * Main toaster component that renders all active toasts
 * Handles toast positioning, styling, and icon display
 * Maps server-side toast types to appropriate UI variants
 *
 * @returns Toast provider with all active toasts rendered
 */
export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <ToastProvider>
      {toasts.map(({ id, title, description, action, variant, className, onClick, ...props }) => (
        <Toast
          key={id}
          variant={variant}
          {...props}
          className={cn("cursor-pointer", className)}
          data-testid="toast"
          onClick={(event) => {
            onClick?.(event);
            const target = event.target as HTMLElement;
            if (target.closest("button")) return;
            dismiss(id);
          }}
        >
          <div className="flex items-start gap-3">
            <ToastIcon variant={variant ?? "default"} />
            <div className="grid gap-1 flex-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
          </div>
          {action}
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
