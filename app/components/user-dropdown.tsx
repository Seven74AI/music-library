// @context7: React, React Router, Tailwind CSS, TypeScript, openimg
/* 
    Before answering my question, MANDATORY use Context7 to fetch documentation for:

    - React
    - React Router
    - Tailwind CSS
    - TypeScript
    - openimg

    Context7 Instructions:
    - resolve-library-id: React
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: React Router
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: Tailwind CSS
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: TypeScript
    - get-library-docs: [resolved-id] (focus: general usage)
    - resolve-library-id: openimg
    - get-library-docs: [resolved-id] (focus: general usage)

    ⚠️  DO NOT PROCEED WITHOUT FETCHING ALL DOCUMENTATION ABOVE!
*/
import { Img } from 'openimg/react'
import { useRef } from 'react'
import { Link, Form } from 'react-router'
import { getUserImgSrc } from '#app/utils/misc.tsx'
import { useUser } from '#app/utils/user.ts'
import { Button } from './ui/button'
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuPortal,
	DropdownMenuContent,
	DropdownMenuItem,
} from './ui/dropdown-menu'
import { Icon } from './ui/icon'

export function UserDropdown() {
	const user = useUser()
	const formRef = useRef<HTMLFormElement>(null)
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button asChild variant="secondary">
					<Link
						to={`/users/${user.username}`}
						// this is for progressive enhancement
						onClick={(e) => e.preventDefault()}
						className="flex items-center gap-2"
						aria-label="User menu"
					>
						<Img
							className="size-8 rounded-full object-cover"
							alt={user.name ?? user.username}
							src={getUserImgSrc(user.image?.objectKey)}
							width={256}
							height={256}
							aria-hidden="true"
						/>
						<span className="text-body-sm font-bold">
							{user.name ?? user.username}
						</span>
					</Link>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuPortal>
				<DropdownMenuContent sideOffset={8} align="end">
					<DropdownMenuItem asChild>
						<Link prefetch="intent" to={`/users/${user.username}`}>
							<Icon className="text-body-md" name="avatar">
								Profile
							</Icon>
						</Link>
					</DropdownMenuItem>
					<DropdownMenuItem asChild>
						<Link prefetch="intent" to={`/users/${user.username}/notes`}>
							<Icon className="text-body-md" name="pencil-2">
								Notes
							</Icon>
						</Link>
					</DropdownMenuItem>
					<DropdownMenuItem asChild>
						<Link prefetch="intent" to="/library">
							<Icon className="text-body-md" name="file-text">
								Music Library
							</Icon>
						</Link>
					</DropdownMenuItem>
					<DropdownMenuItem asChild>
						<Link prefetch="intent" to="/playlists">
							<Icon className="text-body-md" name="file-text">
								Playlists
							</Icon>
						</Link>
					</DropdownMenuItem>
					<DropdownMenuItem asChild>
						<Link prefetch="intent" to="/youtube/playlists">
							<Icon className="text-body-md" name="file-text">
								YouTube Playlists
							</Icon>
						</Link>
					</DropdownMenuItem>
					<Form action="/logout" method="POST" ref={formRef}>
						<DropdownMenuItem asChild>
							<button type="submit" className="w-full">
								<Icon className="text-body-md" name="exit">
									Logout
								</Icon>
							</button>
						</DropdownMenuItem>
					</Form>
				</DropdownMenuContent>
			</DropdownMenuPortal>
		</DropdownMenu>
	)
}
