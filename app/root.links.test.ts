import { expect, test } from "vitest";
import { href as iconsHref } from "#app/components/ui/icon.tsx";
import { links } from "#app/root.tsx";

test("preloads the icon sprite as an image", () => {
  const preload = links().find((link) => link != null && "rel" in link && link.rel === "preload");

  expect(preload).toMatchObject({
    rel: "preload",
    href: iconsHref,
    as: "image",
  });
});
