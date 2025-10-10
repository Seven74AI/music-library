import { Icon } from './icon'

interface ActionButtonProps {
	icon: Parameters<typeof Icon>[0]['name']
	title: string
	onClick?: () => void
	href?: string
	target?: string
	rel?: string
	disabled?: boolean
	className?: string
}

export function ActionButton({ 
	icon, 
	title, 
	onClick, 
	href, 
	target, 
	rel, 
	disabled = false,
	className = "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-8 w-8"
}: ActionButtonProps) {
	const iconElement = <Icon name={icon} className="h-4 w-4" />
	
	if (href) {
		return (
			<a
				href={href}
				target={target}
				rel={rel}
				className={className}
				title={title}
			>
				{iconElement}
			</a>
		)
	}
	
	return (
		<button
			onClick={onClick}
			className={className}
			title={title}
			disabled={disabled}
		>
			{iconElement}
		</button>
	)
}
