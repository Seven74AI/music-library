import { redirect } from 'react-router'
import { type Route } from './+types/import.$service.ts'

/**
 * Redirects old service import route to new service import route
 * @param params - Route parameters containing the service name
 * @returns Redirect response to new route
 */
export async function loader({ params }: Route.LoaderArgs) {
	// Redirect old service import route to new service import route
	return redirect(`/music/services/import/${params.service}`)
}

/**
 * Redirects old service import action to new service import action
 * @param params - Route parameters containing the service name
 * @returns Redirect response to new route
 */
export async function action({ params }: Route.ActionArgs) {
	// Redirect old service import action to new service import action
	return redirect(`/music/services/import/${params.service}`)
}