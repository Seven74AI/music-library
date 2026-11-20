/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CreateKaraokeForm } from "./create-karaoke-form.tsx";

const track = { id: "t1", title: "Song", artist: "Band", lyrics: "stored line 1\nstored line 2" };

const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function renderForm(overrides: Partial<typeof track> = {}) {
  return render(
    <MemoryRouter>
      <CreateKaraokeForm track={{ ...track, ...overrides }} />
    </MemoryRouter>,
  );
}

function lastCreateBody() {
  const call = fetchMock.mock.calls.find(([url]) => url === "/resources/karaoke/create");
  expect(call).toBeDefined();
  return new URLSearchParams(String((call![1] as RequestInit).body));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

test("paste source: submits typed text with default language en", async () => {
  fetchMock.mockImplementation(() => json({ success: true, versionId: "v1" }));
  const user = userEvent.setup();
  renderForm();
  await user.click(screen.getByRole("button", { name: /paste/i }));
  await user.type(screen.getByLabelText(/lyrics text/i), "hello world");
  await user.click(screen.getByRole("button", { name: /create karaoke/i }));

  await screen.findByText(/generating draft/i);
  const body = lastCreateBody();
  expect(body.get("trackId")).toBe("t1");
  expect(body.get("language")).toBe("en");
  expect(body.get("textSource")).toBe("paste");
  expect(body.get("text")).toBe("hello world");
});

test("selecting French is sent as language fr", async () => {
  fetchMock.mockImplementation(() => json({ success: true, versionId: "v1" }));
  const user = userEvent.setup();
  renderForm();
  await user.click(screen.getByLabelText(/french/i));
  await user.click(screen.getByRole("button", { name: /paste/i }));
  await user.type(screen.getByLabelText(/lyrics text/i), "bonjour");
  await user.click(screen.getByRole("button", { name: /create karaoke/i }));
  await screen.findByText(/generating draft/i);
  expect(lastCreateBody().get("language")).toBe("fr");
});

test("track lyrics source prefills textarea from Track.lyrics", async () => {
  fetchMock.mockImplementation(() => json({ success: true, versionId: "v1" }));
  const user = userEvent.setup();
  renderForm();
  await user.click(screen.getByRole("button", { name: /track lyrics/i }));
  expect(screen.getByLabelText(/lyrics text/i)).toHaveValue("stored line 1\nstored line 2");
  await user.click(screen.getByRole("button", { name: /create karaoke/i }));
  await screen.findByText(/generating draft/i);
  const body = lastCreateBody();
  expect(body.get("textSource")).toBe("track-lyrics");
  expect(body.get("text")).toBe("stored line 1\nstored line 2");
});

test("track lyrics source is disabled when the track has no lyrics", () => {
  renderForm({ lyrics: null as never });
  expect(screen.getByRole("button", { name: /track lyrics/i })).toBeDisabled();
});

test("whisper source hides textarea and submits no text", async () => {
  fetchMock.mockImplementation(() => json({ success: true, versionId: "v1" }));
  const user = userEvent.setup();
  renderForm();
  await user.click(screen.getByRole("button", { name: /whisper/i }));
  expect(screen.queryByLabelText(/lyrics text/i)).toBeNull();
  await user.click(screen.getByRole("button", { name: /create karaoke/i }));
  await screen.findByText(/generating draft/i);
  const body = lastCreateBody();
  expect(body.get("textSource")).toBe("whisper");
  expect(body.has("text")).toBe(false);
});

test("AZ/Genius source calls fetch-lyrics and prefills textarea", async () => {
  fetchMock.mockImplementation((url: string) =>
    url === "/resources/karaoke/fetch-lyrics"
      ? json({ success: true, lyrics: "fetched lyrics" })
      : json({ success: true, versionId: "v1" }),
  );
  const user = userEvent.setup();
  renderForm();
  await user.click(screen.getByRole("button", { name: /az\/genius/i }));
  await waitFor(() => expect(screen.getByLabelText(/lyrics text/i)).toHaveValue("fetched lyrics"));
  const call = fetchMock.mock.calls.find(([u]) => u === "/resources/karaoke/fetch-lyrics")!;
  expect(new URLSearchParams(String((call[1] as RequestInit).body)).get("trackId")).toBe("t1");
  await user.click(screen.getByRole("button", { name: /create karaoke/i }));
  await screen.findByText(/generating draft/i);
  expect(lastCreateBody().get("textSource")).toBe("az-genius");
});

test("AZ/Genius error is shown", async () => {
  fetchMock.mockImplementation(() =>
    json({ success: false, error: "Lyrics fetch is not available yet" }, 501),
  );
  const user = userEvent.setup();
  renderForm();
  await user.click(screen.getByRole("button", { name: /az\/genius/i }));
  expect(await screen.findByText(/not available yet/i)).toBeInTheDocument();
});

test("YouTube attach calls the attach action and shows attached video; id is sent on create", async () => {
  fetchMock.mockImplementation((url: string) => {
    if (url === "/resources/karaoke/attach-youtube")
      return json({ success: true, videoFile: { id: "vf1", format: "mp4", fileSize: 5 } });
    return json({ success: true, versionId: "v1" });
  });
  const user = userEvent.setup();
  renderForm();
  await user.type(
    screen.getByLabelText(/youtube url/i),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );
  await user.click(screen.getByRole("button", { name: /attach youtube/i }));
  expect(await screen.findByText(/video attached/i)).toBeInTheDocument();
  const attach = fetchMock.mock.calls.find(([u]) => u === "/resources/karaoke/attach-youtube")!;
  const attachBody = new URLSearchParams(String((attach[1] as RequestInit).body));
  expect(attachBody.get("trackId")).toBe("t1");
  expect(attachBody.get("url")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

  await user.click(screen.getByRole("button", { name: /whisper/i }));
  await user.click(screen.getByRole("button", { name: /create karaoke/i }));
  await screen.findByText(/generating draft/i);
  expect(lastCreateBody().get("videoFileId")).toBe("vf1");
});

test("video upload posts to upload-video and records the video id", async () => {
  fetchMock.mockImplementation((url: string) => {
    if (url === "/api/upload-video")
      return json({ success: true, videoFile: { id: "vf2", format: "mp4", fileSize: 5 } });
    return json({ success: true, versionId: "v1" });
  });
  const user = userEvent.setup();
  renderForm();
  const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
  await user.upload(screen.getByLabelText(/upload video/i), file);
  expect(await screen.findByText(/video attached/i)).toBeInTheDocument();
  const call = fetchMock.mock.calls.find(([u]) => u === "/api/upload-video")!;
  const form = (call[1] as RequestInit).body as FormData;
  expect(form.get("trackId")).toBe("t1");
  expect((form.get("videoFile") as File).name).toBe("clip.mp4");

  await user.click(screen.getByRole("button", { name: /whisper/i }));
  await user.click(screen.getByRole("button", { name: /create karaoke/i }));
  await screen.findByText(/generating draft/i);
  expect(lastCreateBody().get("videoFileId")).toBe("vf2");
});

test("create error is surfaced and form stays editable", async () => {
  fetchMock.mockImplementation(() => json({ success: false, error: "Karaoke generation is disabled" }, 503));
  const user = userEvent.setup();
  renderForm();
  await user.click(screen.getByRole("button", { name: /whisper/i }));
  await user.click(screen.getByRole("button", { name: /create karaoke/i }));
  expect(await screen.findByText(/generation is disabled/i)).toBeInTheDocument();
  expect(screen.queryByText(/generating draft/i)).toBeNull();
});

test("submit is blocked until a text source is chosen", async () => {
  renderForm();
  expect(screen.getByRole("button", { name: /create karaoke/i })).toBeDisabled();
});
