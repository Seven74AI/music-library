import { useId } from 'react'
import { Form, useSearchParams, useSubmit } from 'react-router'
import { useDebounce, useIsPending } from '#app/utils/misc.tsx'
import { Icon } from './ui/icon.tsx'
import { Input } from './ui/input.tsx'
import { Label } from './ui/label.tsx'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from './ui/select.tsx'
import { StatusButton } from './ui/status-button.tsx'

export function SearchBar({
	status,
	autoFocus = false,
	autoSubmit = false,
	action = '/search',
	searchParamName = 'q',
	showTypeSelector = false,
}: {
	status: 'idle' | 'pending' | 'success' | 'error'
	autoFocus?: boolean
	autoSubmit?: boolean
	action?: string
	searchParamName?: string
	showTypeSelector?: boolean
}) {
	const id = useId()
	const [searchParams] = useSearchParams()
	const submit = useSubmit()
	const isSubmitting = useIsPending({
		formMethod: 'GET',
		formAction: action,
	})

	const handleFormChange = useDebounce(async (form: HTMLFormElement) => {
		await submit(form)
	}, 400)

	return (
		<Form
			method="GET"
			action={action}
			className="flex flex-wrap items-center justify-center gap-2"
			onChange={(e) => autoSubmit && handleFormChange(e.currentTarget)}
		>
			<div className="flex-1">
				<Label htmlFor={id} className="sr-only">
					Search
				</Label>
				<Input
					type="search"
					name={searchParamName}
					id={id}
					defaultValue={searchParams.get(searchParamName) ?? ''}
					placeholder="Search tracks, albums, artists..."
					className="w-full"
					autoFocus={autoFocus}
				/>
			</div>
			{showTypeSelector && (
				<Select
					name="type"
					defaultValue={searchParams.get('type') || 'all'}
				>
					<SelectTrigger className="w-[140px]">
						<SelectValue placeholder="All" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All</SelectItem>
						<SelectItem value="tracks">Tracks</SelectItem>
						<SelectItem value="albums">Albums</SelectItem>
						<SelectItem value="artists">Artists</SelectItem>
					</SelectContent>
				</Select>
			)}
			<div>
				<StatusButton
					type="submit"
					status={isSubmitting ? 'pending' : status}
					className="flex w-full items-center justify-center"
				>
					<Icon name="magnifying-glass" size="md" />
					<span className="sr-only">Search</span>
				</StatusButton>
			</div>
		</Form>
	)
}
