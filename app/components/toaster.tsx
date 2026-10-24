import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ToastAction } from "#app/components/ui/toast.tsx";
import { toast as showToast } from "#app/components/ui/use-toast.ts";
import { type Toast } from "#app/utils/toast.server.ts";

/**
 * Available toast variants for different message types
 */
type ToastVariant = "default" | "success" | "destructive" | "error";

/**
 * Custom hook for handling server-side toast notifications
 * Converts server toast types to client-side toast variants
 * Handles navigation and global function calls for toast actions
 *
 * @param toast - Server-side toast data from React Router loader
 * @returns void - Side effect hook that displays toasts
 */
export function useToast(toast?: Toast | null) {
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);

  // Ensure component is mounted before showing toast to prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  const toastId = toast?.id;
  const title = toast?.title;
  const description = toast?.description;
  const type = toast?.type;
  const duration = toast?.duration;
  const action = toast?.action;

  useEffect(() => {
    if (!toastId || !type || !mounted) return;

    const frame = requestAnimationFrame(() => {
      const getVariant = (toastType: Toast["type"]): ToastVariant => {
        switch (toastType) {
          case "error":
            return "error";
          case "success":
            return "success";
          case "destructive":
            return "destructive";
          default:
            return "default";
        }
      };

      const toastOptions: Parameters<typeof showToast>[0] = {
        id: toastId,
        title,
        description,
        variant: getVariant(type),
      };

      if (duration) {
        toastOptions.duration = duration;
      }

      if (action) {
        toastOptions.action = (
          <ToastAction
            altText={action.label}
            onClick={() => {
              if (action.href) {
                void navigate(action.href);
              } else if (action.onClick) {
                const globalFunction = (window as unknown as Record<string, unknown>)[
                  action.onClick
                ];
                if (typeof globalFunction === "function") {
                  globalFunction();
                }
              }
            }}
          >
            {action.label}
          </ToastAction>
        );
      }

      showToast(toastOptions);
    });

    return () => cancelAnimationFrame(frame);
  }, [toastId, title, description, type, duration, action, navigate, mounted]);
}
