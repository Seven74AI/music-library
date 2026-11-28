/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import {
  getPlaybackSource,
  PlaybackSourceIndicator,
  type PlaybackSourceInfo,
} from "./player-playback-source";

describe("getPlaybackSource", () => {
  test("returns null for undefined or empty audioSrc", () => {
    expect(getPlaybackSource({ audioSrc: undefined, isPinnedDownload: false })).toBeNull();
    expect(getPlaybackSource({ audioSrc: "", isPinnedDownload: false })).toBeNull();
  });

  test("returns stream for remote URLs", () => {
    expect(
      getPlaybackSource({ audioSrc: "https://cdn.example/track.mp3", isPinnedDownload: false })
        ?.source,
    ).toBe("stream");
    expect(
      getPlaybackSource({ audioSrc: "/resources/audio/track-1", isPinnedDownload: false })?.source,
    ).toBe("stream");
  });

  test("returns cache for blob without pin", () => {
    expect(getPlaybackSource({ audioSrc: "blob:cached", isPinnedDownload: false })?.source).toBe(
      "cache",
    );
  });

  test("returns downloaded for blob with pin", () => {
    expect(getPlaybackSource({ audioSrc: "blob:cached", isPinnedDownload: true })?.source).toBe(
      "downloaded",
    );
  });

  test("returns stream for remote plus pinned (source wins)", () => {
    const result = getPlaybackSource({
      audioSrc: "https://cdn.example/track.mp3",
      isPinnedDownload: true,
    });
    expect(result?.source).toBe("stream");
    expect(result?.hasDownloadedCopy).toBe(true);
  });

  test("passes through recoveredFromMediaError", () => {
    const result = getPlaybackSource({
      audioSrc: "https://cdn.example/track.mp3",
      isPinnedDownload: false,
      recoveredFromMediaError: true,
    });
    expect(result?.recoveredFromMediaError).toBe(true);
  });
});

describe("PlaybackSourceIndicator", () => {
  function renderIndicator(info: PlaybackSourceInfo) {
    return render(<PlaybackSourceIndicator {...info} />);
  }

  test("stream shows globe and Streaming label", () => {
    renderIndicator({
      source: "stream",
      hasDownloadedCopy: false,
      recoveredFromMediaError: false,
    });
    const indicator = screen.getByTestId("player-source-indicator");
    expect(indicator).toHaveAttribute("data-source", "stream");
    expect(indicator).toHaveAttribute("aria-label", "Streaming");
    expect(indicator).toHaveAttribute("title", "Streaming");
  });

  test("cache shows laptop and Playing from cache label", () => {
    renderIndicator({
      source: "cache",
      hasDownloadedCopy: false,
      recoveredFromMediaError: false,
    });
    const indicator = screen.getByTestId("player-source-indicator");
    expect(indicator).toHaveAttribute("data-source", "cache");
    expect(indicator).toHaveAttribute("aria-label", "Playing from cache");
  });

  test("downloaded shows check-circled and Playing downloaded copy label", () => {
    renderIndicator({
      source: "downloaded",
      hasDownloadedCopy: true,
      recoveredFromMediaError: false,
    });
    const indicator = screen.getByTestId("player-source-indicator");
    expect(indicator).toHaveAttribute("data-source", "downloaded");
    expect(indicator).toHaveAttribute("aria-label", "Playing downloaded copy");
  });

  test("stream with downloaded copy available mentions copy in title", () => {
    renderIndicator({
      source: "stream",
      hasDownloadedCopy: true,
      recoveredFromMediaError: false,
    });
    const indicator = screen.getByTestId("player-source-indicator");
    expect(indicator.getAttribute("title")).toMatch(/downloaded copy/i);
  });

  test("stream after media error recovery uses distinct title", () => {
    renderIndicator({
      source: "stream",
      hasDownloadedCopy: false,
      recoveredFromMediaError: true,
    });
    const indicator = screen.getByTestId("player-source-indicator");
    expect(indicator).toHaveAttribute(
      "title",
      "Playback recovered to streaming after a media error (downloaded copy failed)",
    );
  });
});