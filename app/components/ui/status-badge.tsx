import { Badge } from './badge'

interface StatusBadgeProps {
	status: string
	variant?: 'default' | 'secondary' | 'destructive' | 'outline'
	labels?: Record<string, string>
}

const DEFAULT_STATUS_LABELS = {
	pending: 'Pending',
	processing: 'Processing',
	completed: 'Completed',
	failed: 'Failed',
	running: 'Running',
	paused: 'Paused',
	long_break: 'Long Break',
} as const

const DEFAULT_STATUS_VARIANTS = {
	pending: 'secondary',
	processing: 'default',
	completed: 'default',
	failed: 'destructive',
	running: 'default',
	paused: 'secondary',
	long_break: 'outline',
} as const

export function StatusBadge({ 
	status, 
	variant, 
	labels = DEFAULT_STATUS_LABELS 
}: StatusBadgeProps) {
	const statusVariant = variant || DEFAULT_STATUS_VARIANTS[status as keyof typeof DEFAULT_STATUS_VARIANTS] || 'secondary'
	const statusLabel = labels[status] || status.charAt(0).toUpperCase() + status.slice(1)
	
	return (
		<Badge variant={statusVariant as any}>
			{statusLabel}
		</Badge>
	)
}
