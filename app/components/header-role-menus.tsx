import { Link } from "react-router";
import { useSelectionMode } from "#app/features/curator/selection.ts";
import { discardSession } from "#app/features/curator/session-recovery.client.ts";
import { adminNavSections } from "#app/features/admin/admin-nav.ts";
import { useUser } from "#app/utils/user.ts";
import { curatorMenuItems, headerMenusFor } from "./app-navigation.ts";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Icon } from "./ui/icon";

export function HeaderRoleMenus() {
  const user = useUser();
  const menus = headerMenusFor(user.roles);

  return (
    <>
      {menus.curator.length > 0 ? <CuratorToolsMenu /> : null}
      {menus.admin.length > 0 ? <AdminMenu /> : null}
    </>
  );
}

function CuratorToolsMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-8 gap-1.5 px-2" aria-label="Curator tools">
          <Icon name="pencil-2" size="md" />
          <span className="hidden text-sm lg:inline">Curator</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-[calc(100dvh-12.5rem)] w-56 overflow-y-auto"
      >
        <DropdownMenuLabel>Curator</DropdownMenuLabel>
        <SelectionModeMenuItem />
        <DropdownMenuSeparator />
        {curatorMenuItems.map((item) => (
          <DropdownMenuItem key={item.to} asChild>
            <Link prefetch="intent" to={item.to}>
              <Icon className="text-body-md" name={item.icon}>
                {item.label}
              </Icon>
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            if (typeof discardSession !== "function") return;
            if (window.confirm("This will discard your saved session state. Continue?")) {
              discardSession();
            }
          }}
        >
          <Icon className="text-body-md" name="trash">
            Clear saved session
          </Icon>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SelectionModeMenuItem() {
  const { selectionMode, toggleSelectionMode } = useSelectionMode();

  return (
    <DropdownMenuCheckboxItem
      checked={selectionMode}
      onCheckedChange={() => {
        toggleSelectionMode();
      }}
      onSelect={(event) => {
        event.preventDefault();
      }}
    >
      Selection mode
    </DropdownMenuCheckboxItem>
  );
}

function AdminMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-8 gap-1.5 px-2" aria-label="Admin menu">
          <Icon name="laptop" size="md" />
          <span className="hidden text-sm lg:inline">Admin</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-[calc(100dvh-12.5rem)] w-56 overflow-y-auto"
      >
        <DropdownMenuLabel>Admin</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link prefetch="intent" to="/admin">
            <Icon className="text-body-md" name="laptop">
              Admin overview
            </Icon>
          </Link>
        </DropdownMenuItem>
        {adminNavSections.map((section) => (
          <DropdownMenuGroup key={section.title}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{section.title}</DropdownMenuLabel>
            {section.links.map((link) => (
              <DropdownMenuItem key={link.to} asChild>
                <Link prefetch="intent" to={link.to}>
                  {link.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
