/**
 * @vitest-environment jsdom
 */
import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Checkbox } from "./checkbox.tsx";

describe("Checkbox", () => {
  test("checked state renders sized indicator svg with visible stroke", () => {
    render(<Checkbox checked data-testid="cb" />);

    const indicator = document.querySelector('[data-slot="checkbox-indicator"]');
    expect(indicator).not.toBeNull();

    const svg = indicator?.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("class")).toContain("size-3.5");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");

    const path = svg?.querySelector("path");
    expect(path?.getAttribute("stroke")).toBe("currentColor");
    expect(Number(path?.getAttribute("stroke-width") ?? path?.getAttribute("strokeWidth"))).toBeGreaterThanOrEqual(
      1.5,
    );
  });

  test("unchecked state has no indicator", () => {
    render(<Checkbox checked={false} data-testid="cb" />);
    expect(document.querySelector('[data-slot="checkbox-indicator"]')).toBeNull();
  });
});