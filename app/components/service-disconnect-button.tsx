import { Form, useNavigation } from 'react-router'
import { Button } from '#app/components/ui/button'

interface ServiceDisconnectButtonProps {
	serviceName: string
	disconnectUrl: string
}

export function ServiceDisconnectButton({ 
	serviceName, 
	disconnectUrl 
}: ServiceDisconnectButtonProps) {
	const navigation = useNavigation()
	const isDisconnecting = navigation.state === 'submitting' && 
		navigation.formAction === disconnectUrl

	const handleDisconnect = (event: React.MouseEvent) => {
		if (!confirm(`Are you sure you want to disconnect from ${serviceName}?`)) {
			event.preventDefault()
		}
	}

	return (
		<Form method="post" action={disconnectUrl}>
			<Button 
				variant="destructive" 
				size="sm"
				onClick={handleDisconnect}
				disabled={isDisconnecting}
			>
				{isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
			</Button>
		</Form>
	)
}
