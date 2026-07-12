import { data } from 'react-router'
import {
	addTrackToUserLibrary,
	addTracksToUserLibrary,
	removeTrackFromUserLibrary,
} from '#app/features/user-library/user-library.server'
import { requireUserId } from '#app/utils/auth.server.ts'
import { createToastHeaders } from '#app/utils/toast.server.ts'
import { proxyClientActionToServer } from '#app/utils/server-proxy-client-action.ts'
import { type Route } from './+types/track-library'

/**
 * Resource route for adding/removing tracks to/from the user's personal library.
 *
 * POST /resources/track-library
 * Body: trackId (string) OR trackIds (string[], repeated), action ("add" | "remove")
 */
export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()

	const actionType = formData.get('action')
	const bulkTrackIds = formData
		.getAll('trackIds')
		.filter((id): id is string => typeof id === 'string' && id.length > 0)
	const singleTrackId = formData.get('trackId')
	const trackId =
		typeof singleTrackId === 'string' && singleTrackId ? singleTrackId : null

	if (bulkTrackIds.length === 0 && !trackId) {
		return data(
			{ status: 'error', message: 'Invalid track ID' },
			{
				status: 400,
				headers: await createToastHeaders({
					title: 'Error',
					description: 'Invalid track ID provided',
					type: 'error',
				}),
			},
		)
	}

	if (actionType !== 'add' && actionType !== 'remove') {
		return data(
			{ status: 'error', message: 'Invalid action' },
			{
				status: 400,
				headers: await createToastHeaders({
					title: 'Error',
					description: 'Invalid action. Must be "add" or "remove".',
					type: 'error',
				}),
			},
		)
	}

	try {
		if (actionType === 'add') {
			if (bulkTrackIds.length > 0) {
				const result = await addTracksToUserLibrary(bulkTrackIds, userId)
				if (!result.success) {
					return data(
						{ status: 'error', message: result.message },
						{
							status: 500,
							headers: await createToastHeaders({
								title: 'Error',
								description: result.message,
								type: 'error',
							}),
						},
					)
				}
				return data(
					{ status: 'success', message: result.message, addedCount: result.addedCount },
					{
						headers: await createToastHeaders({
							title: 'Added to Library',
							description: result.message,
							type: 'success',
						}),
					},
				)
			}

			const result = await addTrackToUserLibrary(trackId!, userId)
			if (!result.success) {
				return data(
					{ status: 'error', message: result.message },
					{
						status: 500,
						headers: await createToastHeaders({
							title: 'Error',
							description: result.message,
							type: 'error',
						}),
					},
				)
			}
			return data(
				{ status: 'success', message: result.message },
				{
					headers: await createToastHeaders({
						title: 'Added to Library',
						description: 'Track has been added to your library.',
						type: 'success',
					}),
				},
			)
		}

		if (!trackId) {
			return data(
				{ status: 'error', message: 'Invalid track ID' },
				{
					status: 400,
					headers: await createToastHeaders({
						title: 'Error',
						description: 'Bulk remove is not supported. Provide a single trackId.',
						type: 'error',
					}),
				},
			)
		}

		const result = await removeTrackFromUserLibrary(trackId, userId)
		if (!result.success) {
			return data(
				{ status: 'error', message: result.message },
				{
					status: 404,
					headers: await createToastHeaders({
						title: 'Error',
						description: result.message,
						type: 'error',
					}),
				},
			)
		}
		return data(
			{ status: 'success', message: result.message },
			{
				headers: await createToastHeaders({
					title: 'Removed from Library',
					description: 'Track has been removed from your library.',
					type: 'success',
				}),
			},
		)
	} catch (error) {
		console.error('Error in track-library action:', error)
		return data(
			{ status: 'error', message: 'Internal server error' },
			{
				status: 500,
				headers: await createToastHeaders({
					title: 'Error',
					description: 'Failed to update library. Please try again.',
					type: 'error',
				}),
			},
		)
	}
}

export async function clientAction(args: Route.ClientActionArgs) {
	return proxyClientActionToServer(args)
}
