/**
 * @vitest-environment jsdom
 */
import { expect, test } from "vitest";
import {
  TRACK_LIST_HEADER_HEIGHT_PX,
  TRACK_LIST_ROW_HEIGHT_PX,
  estimateTrackListItemSize,
  measureTrackListElement,
} from "./track-list-virtualizer.ts";

test("estimates the column header separately from track rows", () => {
  expect(estimateTrackListItemSize(0, true)).toBe(TRACK_LIST_HEADER_HEIGHT_PX);
  expect(estimateTrackListItemSize(1, true)).toBe(TRACK_LIST_ROW_HEIGHT_PX);
  expect(estimateTrackListItemSize(0, false)).toBe(TRACK_LIST_ROW_HEIGHT_PX);
});

test("uses the real row height when layout has measured it", () => {
  const element = document.createElement("div");
  element.dataset.index = "3";
  Object.defineProperty(element, "offsetHeight", { value: 96 });

  const instance = {
    options: {
      horizontal: false,
      useCachedMeasurements: false,
      estimateSize: () => TRACK_LIST_ROW_HEIGHT_PX,
      getItemKey: (index: number) => index,
    },
    indexFromElement: (node: Element) => Number(node.getAttribute("data-index")),
    itemSizeCache: new Map(),
  };

  expect(measureTrackListElement(element, undefined, instance as never)).toBe(96);
});

test("falls back to the estimate before the browser lays the row out", () => {
  const element = document.createElement("div");
  element.dataset.index = "1";

  const instance = {
    options: {
      horizontal: false,
      useCachedMeasurements: false,
      estimateSize: (index: number) => estimateTrackListItemSize(index, true),
      getItemKey: (index: number) => index,
    },
    indexFromElement: (node: Element) => Number(node.getAttribute("data-index")),
    itemSizeCache: new Map(),
  };

  expect(measureTrackListElement(element, undefined, instance as never)).toBe(
    TRACK_LIST_ROW_HEIGHT_PX,
  );
});
