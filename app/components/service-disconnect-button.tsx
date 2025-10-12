import { Form, useNavigation } from 'react-router'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '#app/components/ui/alert-dialog'
import { Button } from '#app/components/ui/button'

interface ServiceDisconnectButtonProps {
	serviceName: string
	disconnectUrl: string
}

/**
 * Service Disconnect Button Component
 * 
 * Provides a confirmation dialog for disconnecting from a service.
 * Uses AlertDialog instead of browser confirm() for better UX.
 * 
 * @param serviceName - The name of the service to disconnect from
 * @param disconnectUrl - The URL to POST to for disconnecting
 */
export function ServiceDisconnectButton({ 
	serviceName, 
	disconnectUrl 
}: ServiceDisconnectButtonProps) {
	const navigation = useNavigation()
	const isDisconnecting = navigation.state === 'submitting' && 
		navigation.formAction === disconnectUrl

	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button 
					variant="destructive" 
					size="sm"
					disabled={isDisconnecting}
				>
					{isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Disconnect Service</AlertDialogTitle>
					<AlertDialogDescription>
						Are you sure you want to disconnect from {serviceName}?
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<Form method="post" action={disconnectUrl}>
						<AlertDialogAction asChild>
							<Button type="submit" variant="destructive">
								Disconnect
							</Button>
						</AlertDialogAction>
					</Form>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
