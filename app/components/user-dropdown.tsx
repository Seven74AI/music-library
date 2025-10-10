import { useRef } from 'react'
import { Link, Form } from 'react-router'
import { getUserImgSrc } from '#app/utils/misc.tsx'
import { useUser, userHasRole  } from '#app/utils/user.ts'
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar'
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
	const isAdmin = userHasRole(user, 'admin')
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" className="relative h-8 w-8 rounded-full p-0" aria-label="User menu">
					<Avatar className="h-8 w-8">
						<AvatarImage 
							src={getUserImgSrc(user.image?.objectKey)} 
							alt={user.name ?? user.username} 
						/>
						<AvatarFallback>
							{user.name?.[0] ?? user.username[0]}
						</AvatarFallback>
					</Avatar>
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
						<Link prefetch="intent" to="/music">
							<Icon className="text-body-md" name="file-text">
								Music Hub
							</Icon>
						</Link>
					</DropdownMenuItem>
					<DropdownMenuItem asChild>
						<Link prefetch="intent" to="/library">
							<Icon className="text-body-md" name="file-text">
								My Library
							</Icon>
						</Link>
					</DropdownMenuItem>
					<DropdownMenuItem asChild>
						<Link prefetch="intent" to="/playlists">
							<Icon className="text-body-md" name="file-text">
								My Playlists
							</Icon>
						</Link>
					</DropdownMenuItem>
					<DropdownMenuItem asChild>
						<Link prefetch="intent" to="/music/services">
							<Icon className="text-body-md" name="link-2">
								Connected Services
							</Icon>
						</Link>
					</DropdownMenuItem>
					{isAdmin && (
						<DropdownMenuItem asChild>
							<Link prefetch="intent" to="/admin/audio-queue">
								<Icon className="text-body-md" name="file-text">
									Audio Queue Admin
								</Icon>
							</Link>
						</DropdownMenuItem>
					)}
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
