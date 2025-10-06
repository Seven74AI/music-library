import { redirect } from 'react-router'
import { type Route } from './+types/import.$service.ts'

export async function loader({ params }: Route.LoaderArgs) {
	// Redirect old service import route to new service import route
	return redirect(`/music/services/import/${params.service}`)
}

export async function action({ params }: Route.ActionArgs) {
	// Redirect old service import action to new service import action
	return redirect(`/music/services/import/${params.service}`)
}