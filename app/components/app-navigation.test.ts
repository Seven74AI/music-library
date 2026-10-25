import { expect, test } from "vitest";
import { desktopNavItemsFor, listeningNavItemsFor } from "./app-navigation.ts";

test("signed-out listening nav keeps only home and search", () => {
  expect(listeningNavItemsFor(false).map((item) => item.to)).toEqual(["/", "/search"]);
});

test("signed-out desktop nav is empty", () => {
  expect(desktopNavItemsFor(false)).toEqual([]);
});

test("signed-in desktop nav keeps account destinations and drops the search link", () => {
  expect(desktopNavItemsFor(true).map((item) => item.to)).toEqual([
    "/",
    "/discover",
    "/library",
    "/playlists",
    "/history",
  ]);
});

test("signed-in listening nav keeps every destination", () => {
  expect(listeningNavItemsFor(true).map((item) => item.label)).toEqual([
    "Home",
    "Discover",
    "Search",
    "My Library",
    "My Playlists",
    "History",
  ]);
});
