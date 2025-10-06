import { redirect } from 'react-router'
import { type Route } from './+types/import.ts'

export async function loader({}: Route.LoaderArgs) {
	// Redirect old import route to new service import hub
	return redirect('/music/services/import')
}