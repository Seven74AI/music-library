/**
 * @vitest-environment jsdom
 */
import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test } from "vitest";
import { listeningNavItems } from "./app-navigation.ts";
import { BottomNav } from "./bottom-nav.tsx";

/** Narrow phone width where six full labels collide. */
const NARROW_PHONE_PX = 390;

function renderBottomNav() {
  const router = createMemoryRouter([{ path: "*", element: <BottomNav signedIn /> }], {
    initialEntries: ["/"],
  });
  render(<RouterProvider router={router} />);
}

function classTokens(className: string) {
  return new Set(className.split(/\s+/).filter(Boolean));
}

function fontSizePx(className: string) {
  const custom = className.match(/(?:^|\s)text-\[(\d+(?:\.\d+)?)px\](?:\s|$)/);
  if (custom?.[1]) return Number(custom[1]);
  const tokens = classTokens(className);
  if (tokens.has("text-xs")) return 12;
  if (tokens.has("text-sm")) return 14;
  return 16;
}

/**
 * Upper bound for one line of UI sans text. Sized so "My Playlists" at
 * text-xs is wider than an equal share of a 390px row.
 */
function maxLabelWidthPx(text: string, sizePx: number) {
  return text.length * sizePx * 0.58;
}

function labelStaysInCell(options: {
  itemClass: string;
  labelClass: string;
  label: string;
  fontClass: string;
  cellWidth: number;
}) {
  const labelTokens = classTokens(options.labelClass);
  const itemTokens = classTokens(options.itemClass);
  const nowrap = labelTokens.has("whitespace-nowrap") || labelTokens.has("truncate");
  const clips =
    labelTokens.has("truncate") ||
    (labelTokens.has("overflow-hidden") &&
      labelTokens.has("whitespace-nowrap") &&
      labelTokens.has("text-ellipsis"));
  const equalCell = itemTokens.has("min-w-0") && itemTokens.has("flex-1");
  const fitsOnOneLine =
    maxLabelWidthPx(options.label, fontSizePx(options.fontClass)) <= options.cellWidth;

  if (fitsOnOneLine) return true;
  // Wider than an equal share of 390px. Clip inside the cell instead of wrapping
  // onto a second line that paints over the next tab.
  return nowrap && clips && equalCell;
}

test("six listening tabs stay on one line without overlapping at 390px", () => {
  renderBottomNav();

  const nav = screen.getByRole("navigation", { name: "Main navigation" });
  const items = within(nav).getAllByRole("listitem");
  expect(items).toHaveLength(6);
  expect(listeningNavItems).toHaveLength(6);

  const cellWidth = NARROW_PHONE_PX / listeningNavItems.length;

  for (const tab of listeningNavItems) {
    const link = within(nav).getByRole("link", { name: tab.ariaLabel });
    expect(link).toHaveAttribute("href", tab.to);
    expect(link).toHaveAttribute("aria-label", tab.ariaLabel);

    const item = link.closest("li");
    expect(item).not.toBeNull();
    const label = within(link).getByText(tab.label);
    const itemClass = item?.getAttribute("class") ?? "";
    const labelClass = label.getAttribute("class") ?? "";
    const fontClass = `${link.getAttribute("class") ?? ""} ${labelClass}`;

    expect(
      labelStaysInCell({
        itemClass,
        labelClass,
        label: tab.label,
        fontClass,
        cellWidth,
      }),
      `${tab.label} wraps or paints into the next tab at ${NARROW_PHONE_PX}px`,
    ).toBe(true);
  }
});
