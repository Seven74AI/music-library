/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { type WeeklyWrapSummary } from "#app/features/weekly-wrap/weekly-wrap.server.ts";
import { WeeklyWrap } from "./weekly-wrap.tsx";

test("renders nothing when wrap is null (empty week)", () => {
  const { container } = render(<WeeklyWrap wrap={null} />);
  expect(container).toBeEmptyDOMElement();
});

test("shows finishes and unique tracks without streak when dayStreak is null", () => {
  const wrap: WeeklyWrapSummary = {
    finishes: 12,
    uniqueTracks: 8,
    dayStreak: null,
  };
  render(<WeeklyWrap wrap={wrap} />);

  expect(screen.getByText(/this week/i)).toBeInTheDocument();
  expect(screen.getByText(/12 finishes/i)).toBeInTheDocument();
  expect(screen.getByText(/8 tracks/i)).toBeInTheDocument();
  expect(screen.queryByText(/streak/i)).not.toBeInTheDocument();
});

test("includes day streak copy when streak is greater than 1", () => {
  const wrap: WeeklyWrapSummary = {
    finishes: 5,
    uniqueTracks: 3,
    dayStreak: 4,
  };
  render(<WeeklyWrap wrap={wrap} />);

  expect(screen.getByText(/5 finishes/i)).toBeInTheDocument();
  expect(screen.getByText(/3 tracks/i)).toBeInTheDocument();
  expect(screen.getByText(/4-day streak/i)).toBeInTheDocument();
});
