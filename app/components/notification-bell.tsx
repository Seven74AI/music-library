import { useEffect } from 'react'
import { Link, useFetcher, useRevalidator } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { toast } from '#app/components/ui/use-toast.ts'
import { cn } from '#app/utils/misc.tsx'

export type NotificationItem = {
	id: string
	type: string
	title: string
	body: string
	linkUrl: string | null
	readAt: Date | string | null
	createdAt: Date | string
}

type NotificationBellProps = {
	notifications: NotificationItem[]
	unreadCount: number
}

export function NotificationBell({
	notifications,
	unreadCount,
}: NotificationBellProps) {
	const fetcher = useFetcher<{ ok: boolean }>()
	const { revalidate } = useRevalidator()

	useEffect(() => {
		if (fetcher.state === 'idle' && fetcher.data?.ok) {
			void revalidate()
		}
	}, [fetcher.data, fetcher.state, revalidate])

	useEffect(() => {
		if (fetcher.state === 'idle' && fetcher.data && fetcher.data.ok === false) {
			toast({
				title: 'Failed to mark as read',
				description: 'Please try again later.',
				variant: 'destructive',
			})
		}
	}, [fetcher.data, fetcher.state])

	const markNotificationRead = (notificationId: string) => {
		void fetcher.submit(
			{ intent: 'mark-read', notificationId },
			{ method: 'POST', action: '/resources/notifications' },
		)
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="relative h-8 w-8 p-0"
					aria-label={
						unreadCount > 0
							? `${unreadCount} unread notifications`
							: 'Notifications'
					}
				>
					<Icon name="envelope-closed" className="h-4 w-4" />
					{unreadCount > 0 ? (
						<span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
							{unreadCount > 9 ? '9+' : unreadCount}
						</span>
					) : null}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuPortal>
				<DropdownMenuContent align="end" sideOffset={8} className="w-80">
					<div className="flex items-center justify-between px-2 py-1.5">
						<p className="text-sm font-semibold">Notifications</p>
						{unreadCount > 0 ? (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="h-7 px-2 text-xs"
								onClick={() => {
									void fetcher.submit(
										{ intent: 'mark-all-read' },
										{ method: 'POST', action: '/resources/notifications' },
									)
								}}
							>
								Mark all read
							</Button>
						) : null}
					</div>
					<DropdownMenuSeparator />
					{notifications.length === 0 ? (
						<p className="px-2 py-4 text-sm text-muted-foreground">
							No notifications yet.
						</p>
					) : (
						notifications.map((notification) => (
							<NotificationRow
								key={notification.id}
								notification={notification}
								onMarkRead={markNotificationRead}
							/>
						))
					)}
				</DropdownMenuContent>
			</DropdownMenuPortal>
		</DropdownMenu>
	)
}

function NotificationRow({
	notification,
	onMarkRead,
}: {
	notification: NotificationItem
	onMarkRead: (notificationId: string) => void
}) {
	const isUnread = notification.readAt === null
	const content = (
		<div className="flex flex-col gap-0.5 py-1">
			<span
				className={cn(
					'text-sm leading-snug',
					isUnread ? 'font-semibold' : 'font-medium text-muted-foreground',
				)}
			>
				{notification.title}
			</span>
			<span className="text-xs text-muted-foreground">{notification.body}</span>
		</div>
	)

	if (notification.linkUrl) {
		return (
			<DropdownMenuItem asChild className="items-start">
				<Link
					to={notification.linkUrl}
					prefetch="intent"
					className="w-full"
					onClick={() => {
						if (isUnread) {
							onMarkRead(notification.id)
						}
					}}
				>
					{content}
				</Link>
			</DropdownMenuItem>
		)
	}

	return (
		<DropdownMenuItem
			className="items-start"
			onSelect={() => {
				if (isUnread) {
					onMarkRead(notification.id)
				}
			}}
		>
			{content}
		</DropdownMenuItem>
	)
}
