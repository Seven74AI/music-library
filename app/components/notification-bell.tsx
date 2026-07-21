import { useEffect, useRef } from "react";
import { Link, useFetcher } from "react-router";
import { Button } from "#app/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#app/components/ui/dropdown-menu.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { toast } from "#app/components/ui/use-toast.ts";
import { cn } from "#app/utils/misc.tsx";

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  linkUrl: string | null;
  /** Prisma returns Date objects; JSON serialization over the wire produces ISO strings. */
  readAt: Date | null;
  createdAt: Date | string;
};

type NotificationLoaderData = {
  notifications: NotificationItem[];
  unreadCount: number;
};

type NotificationBellProps = {
  notifications: NotificationItem[];
  unreadCount: number;
};

export function NotificationBell({ notifications, unreadCount }: NotificationBellProps) {
  const fetcher = useFetcher<{ ok: boolean }>();
  const isSubmitting = fetcher.state !== "idle";
  const refreshFetcher = useFetcher<NotificationLoaderData>();
  const lastIntentRef = useRef<"mark-read" | "mark-all-read" | null>(null);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;

    if (fetcher.data.ok) {
      void refreshFetcher.load("/resources/notifications");
      return;
    }

    // Show error toast on failure
    const label =
      lastIntentRef.current === "mark-all-read"
        ? "Failed to mark all notifications as read"
        : "Failed to mark notification as read";
    toast({ title: label, variant: "destructive" });
  }, [fetcher.data, fetcher.state]);

  const displayNotifications = refreshFetcher.data?.notifications ?? notifications;
  const displayUnreadCount = refreshFetcher.data?.unreadCount ?? unreadCount;

  const markNotificationRead = (notificationId: string) => {
    if (isSubmitting) return;
    lastIntentRef.current = "mark-read";
    void fetcher.submit(
      { intent: "mark-read", notificationId },
      { method: "POST", action: "/resources/notifications" },
    );
  };

  const handleMarkAllRead = () => {
    if (isSubmitting) return;
    lastIntentRef.current = "mark-all-read";
    void fetcher.submit(
      { intent: "mark-all-read" },
      { method: "POST", action: "/resources/notifications" },
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative h-8 w-8 p-0"
          aria-label={
            isSubmitting
              ? "Processing notifications..."
              : displayUnreadCount > 0
                ? `${displayUnreadCount} unread notifications`
                : "Notifications"
          }
        >
          <Icon
            name={isSubmitting ? "update" : "envelope-closed"}
            className={cn("h-4 w-4", isSubmitting && "animate-spin")}
          />
          {displayUnreadCount > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {displayUnreadCount > 9 ? "9+" : displayUnreadCount}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent align="end" sideOffset={8} className="w-80">
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="text-sm font-semibold">Notifications</p>
            {displayUnreadCount > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={isSubmitting}
                onClick={handleMarkAllRead}
              >
                {isSubmitting ? <Icon name="update" className="mr-1 h-3 w-3 animate-spin" /> : null}
                Mark all read
              </Button>
            ) : null}
          </div>
          <DropdownMenuSeparator />
          {isSubmitting && (
            <div className="sr-only" role="status" aria-live="assertive">
              Processing notifications...
            </div>
          )}
          {displayNotifications.length === 0 ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">No notifications yet.</p>
          ) : (
            displayNotifications.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                onMarkRead={markNotificationRead}
                disabled={isSubmitting}
              />
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}

function NotificationRow({
  notification,
  onMarkRead,
  disabled = false,
}: {
  notification: NotificationItem;
  onMarkRead: (notificationId: string) => void;
  disabled?: boolean;
}) {
  const isUnread = notification.readAt === null;
  const content = (
    <div className="flex flex-col gap-0.5 py-1">
      <span
        className={cn(
          "text-sm leading-snug",
          isUnread ? "font-semibold" : "font-medium text-muted-foreground",
        )}
      >
        {notification.title}
      </span>
      <span className="text-xs text-muted-foreground">{notification.body}</span>
    </div>
  );

  if (notification.linkUrl) {
    return (
      <DropdownMenuItem asChild className="items-start" disabled={disabled}>
        <Link
          to={notification.linkUrl}
          prefetch="intent"
          className="w-full"
          onClick={(e) => {
            if (disabled) {
              e.preventDefault();
              return;
            }
            if (isUnread) {
              onMarkRead(notification.id);
            }
          }}
        >
          {content}
        </Link>
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuItem
      className="items-start"
      disabled={disabled}
      onSelect={() => {
        if (isUnread) {
          onMarkRead(notification.id);
        }
      }}
    >
      {content}
    </DropdownMenuItem>
  );
}
