import { useRef } from "react";
import { Link, Form } from "react-router";
import { getUserImgSrc } from "#app/utils/misc.tsx";
import { useUser } from "#app/utils/user.ts";
import { accountMenuItems } from "./app-navigation.ts";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu";
import { Icon } from "./ui/icon";

export function UserDropdown() {
  const user = useUser();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="relative h-8 w-8 rounded-full p-0"
          aria-label="User menu"
        >
          <Avatar className="h-8 w-8">
            <AvatarImage
              src={getUserImgSrc(user.image?.objectKey)}
              alt={user.name ?? user.username}
            />
            <AvatarFallback>{user.name?.[0] ?? user.username[0]}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent
          sideOffset={8}
          align="end"
          collisionPadding={8}
          className="max-h-[calc(100dvh-12.5rem)] max-w-[calc(100%-1rem)] overflow-y-auto"
        >
          <DropdownMenuLabel>Account</DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <Link prefetch="intent" to={`/users/${user.username}`}>
              <Icon className="text-body-md" name="avatar">
                Profile
              </Icon>
            </Link>
          </DropdownMenuItem>
          {accountMenuItems.map((item) => (
            <DropdownMenuItem key={item.to} asChild>
              <Link prefetch="intent" to={item.to}>
                <Icon className="text-body-md" name={item.icon}>
                  {item.label}
                </Icon>
              </Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
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
  );
}
