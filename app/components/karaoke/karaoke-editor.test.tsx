/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  KaraokeEditor,
  type KaraokeEditorVersion,
  type KaraokeVersionSummary,
} from "./karaoke-editor.tsx";

const resolveMock = vi.hoisted(() => vi.fn());
vi.mock("#app/features/offline-storage/resolve-playback-url.client.ts", () => ({
  resolveTrackPlaybackSource: resolveMock,
}));

const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

const version: KaraokeEditorVersion = {
  id: "v1",
  status: "draft",
  language: "en",
  source: "paste",
  lyricsText: "hello big\nbye",
  jobStatus: "completed",
  lines: [
    [
      { word: "hello", start: 1, end: 1.5 },
      { word: "big", start: 1.6, end: 2 },
    ],
    [{ word: "bye", start: 3, end: 3.5 }],
  ],
};

const versions: KaraokeVersionSummary[] = [
  {
    id: "v1",
    status: "draft",
    createdAt: "2026-01-02T00:00:00.000Z",
    language: "en",
    source: "paste",
    createdBy: "u1",
  },
  {
    id: "v0",
    status: "ready",
    createdAt: "2026-01-01T00:00:00.000Z",
    language: "en",
    source: "whisper",
    createdBy: "u1",
  },
];

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderEditor(
  overrides: Partial<KaraokeEditorVersion> = {},
  currentVersionId: string | null = "v0",
) {
  return render(
    <MemoryRouter initialEntries={["/library/t1/karaoke/v1"]}>
      <Routes>
        <Route
          path="/library/:trackId/karaoke/:versionId"
          element={
            <>
              <KaraokeEditor
                trackId="t1"
                version={{ ...version, ...overrides }}
                versions={versions}
                currentVersionId={currentVersionId}
              />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function bodyOf(url: string) {
  const call = fetchMock.mock.calls.find(([u]) => u === url);
  expect(call).toBeDefined();
  return new URLSearchParams(String((call![1] as RequestInit).body));
}

async function savedLines(
  user: ReturnType<typeof userEvent.setup>,
): Promise<any> {
  fetchMock.mockImplementation(() => json({ success: true, versionId: "v2" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  return JSON.parse(bodyOf("/resources/karaoke/save-edit").get("lines")!);
}

beforeEach(() => {
  fetchMock.mockReset();
  resolveMock.mockReset();
  resolveMock.mockResolvedValue("https://cdn.example/t1.mp3");
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

test("renders lines and words", () => {
  renderEditor();
  expect((screen.getByLabelText("Word 1.1") as HTMLInputElement).value).toBe(
    "hello",
  );
  expect((screen.getByLabelText("Word 1.2") as HTMLInputElement).value).toBe(
    "big",
  );
  expect((screen.getByLabelText("Word 2.1") as HTMLInputElement).value).toBe(
    "bye",
  );
  expect((screen.getByLabelText("Start 1.2") as HTMLInputElement).value).toBe(
    "1.6",
  );
});

test("save posts unchanged text + lines for the version and navigates to the new one", async () => {
  fetchMock.mockImplementation(() => json({ success: true, versionId: "v2" }));
  const user = userEvent.setup();
  renderEditor();
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(screen.getByTestId("where").textContent).toBe(
      "/library/t1/karaoke/v2",
    ),
  );
  const body = bodyOf("/resources/karaoke/save-edit");
  expect(body.get("versionId")).toBe("v1");
  expect(body.get("text")).toBe("hello big\nbye");
  expect(JSON.parse(body.get("lines")!)).toEqual(version.lines);
});

test("edit word text, nudge and set times are serialized", async () => {
  const user = userEvent.setup();
  renderEditor();
  const word = screen.getByLabelText("Word 1.1");
  await user.clear(word);
  await user.type(word, "yo");
  await user.click(screen.getByRole("button", { name: "Start later 1.1" }));
  await user.click(screen.getByRole("button", { name: "End earlier 1.1" }));
  const end = screen.getByLabelText("End 2.1");
  await user.clear(end);
  await user.type(end, "4.25");
  const lines = await savedLines(user);
  expect(lines[0][0]).toEqual({ word: "yo", start: 1.05, end: 1.45 });
  expect(lines[1][0]).toEqual({ word: "bye", start: 3, end: 4.25 });
  expect(bodyOf("/resources/karaoke/save-edit").get("text")).toBe(
    "yo big\nbye",
  );
});

test("add, delete and merge words", async () => {
  const user = userEvent.setup();
  renderEditor();
  await user.click(screen.getByRole("button", { name: "Merge with next 1.1" }));
  expect((screen.getByLabelText("Word 1.1") as HTMLInputElement).value).toBe(
    "hellobig",
  );
  await user.click(screen.getByRole("button", { name: "Add word after 1.1" }));
  expect((screen.getByLabelText("Word 1.2") as HTMLInputElement).value).toBe(
    "word",
  );
  await user.click(screen.getByRole("button", { name: "Delete word 2.1" }));
  const lines = await savedLines(user);
  expect(lines[0].map((w: { word: string }) => w.word)).toEqual([
    "hellobig",
    "word",
  ]);
  expect(lines[1]).toEqual([]);
});

test("move word to next line and add a line", async () => {
  const user = userEvent.setup();
  renderEditor();
  await user.click(
    screen.getByRole("button", { name: "Move to next line 1.2" }),
  );
  await user.click(screen.getByRole("button", { name: "Add line after 1" }));
  const lines = await savedLines(user);
  expect(lines.map((l: unknown[]) => l.length)).toEqual([1, 0, 2]);
  expect(lines[2][0].word).toBe("big");
});

test("invalid timings block save client-side", async () => {
  const user = userEvent.setup();
  renderEditor();
  const start = screen.getByLabelText("Start 2.1");
  await user.clear(start);
  await user.type(start, "0.5");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/non-decreasing/i);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("version history lists versions, marks current, restore posts", async () => {
  fetchMock.mockImplementation(() =>
    json({ success: true, currentVersionId: "v1" }),
  );
  const user = userEvent.setup();
  renderEditor();
  const history = screen.getByRole("region", { name: "Version history" });
  expect(within(history).getAllByRole("listitem")).toHaveLength(2);
  expect(within(history).getByText(/current/i)).toBeInTheDocument();
  expect(
    within(history).queryByRole("button", { name: "Restore v0" }),
  ).toBeNull();
  await user.click(within(history).getByRole("button", { name: "Restore v1" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(bodyOf("/resources/karaoke/restore").get("versionId")).toBe("v1");
});

test("mark ready posts and surfaces a 409", async () => {
  fetchMock.mockImplementation(() =>
    json(
      { success: false, error: "Version generation has not completed" },
      409,
    ),
  );
  const user = userEvent.setup();
  renderEditor();
  await user.click(screen.getByRole("button", { name: "Mark ready" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Version generation has not completed",
  );
  expect(bodyOf("/resources/karaoke/mark-ready").get("versionId")).toBe("v1");
});

test("mark ready is disabled while generating, and editing is replaced by a status", () => {
  renderEditor({ jobStatus: "processing", lines: [] });
  expect(screen.getByText(/generating/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Mark ready" })).toBeDisabled();
});

test("mark ready is disabled with unsaved changes", async () => {
  const user = userEvent.setup();
  renderEditor();
  await user.click(screen.getByRole("button", { name: "Delete word 2.1" }));
  expect(screen.getByRole("button", { name: "Mark ready" })).toBeDisabled();
});

test("re-align posts the text; re-transcribe posts an explicit empty text", async () => {
  fetchMock.mockImplementation(() =>
    json({ success: true, versionId: "v3", jobId: "j1" }),
  );
  const user = userEvent.setup();
  renderEditor();
  const text = screen.getByLabelText("Lyrics text");
  await user.clear(text);
  await user.type(text, "new words");
  await user.click(screen.getByRole("button", { name: "Re-align" }));
  await waitFor(() =>
    expect(screen.getByTestId("where").textContent).toBe(
      "/library/t1/karaoke/v3",
    ),
  );
  const body = bodyOf("/resources/karaoke/re-align");
  expect(body.get("versionId")).toBe("v1");
  expect(body.get("text")).toBe("new words");

  fetchMock.mockClear();
  await user.click(screen.getByRole("button", { name: "Re-transcribe" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const body2 = bodyOf("/resources/karaoke/re-align");
  expect(body2.has("text")).toBe(true);
  expect(body2.get("text")).toBe("");
});

test("preview audio uses the resolved playback URL", async () => {
  const { container } = renderEditor();
  await waitFor(() =>
    expect(container.querySelector("audio")?.getAttribute("src")).toBe(
      "https://cdn.example/t1.mp3",
    ),
  );
  expect(resolveMock).toHaveBeenCalledWith("t1");
});

test("preview audio surfaces an error when the source cannot be resolved", async () => {
  resolveMock.mockResolvedValue(null);
  renderEditor();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /could not load audio/i,
  );
});

test("re-align, re-transcribe and restore are disabled while generating", () => {
  renderEditor({ jobStatus: "dispatched", lines: [] });
  expect(screen.getByRole("button", { name: "Re-align" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Re-transcribe" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Restore v1" })).toBeDisabled();
});

test("mark ready is disabled when there are no lines", () => {
  renderEditor({ lines: [] });
  expect(screen.getByRole("button", { name: "Mark ready" })).toBeDisabled();
});

test("time input commits on blur, not per keystroke, and reverts invalid text", async () => {
  const user = userEvent.setup();
  renderEditor();
  const start = screen.getByLabelText("Start 1.1") as HTMLInputElement;
  await user.clear(start);
  expect(screen.getByRole("button", { name: "Mark ready" })).toBeEnabled();
  await user.tab();
  expect(start.value).toBe("1");
  await user.clear(start);
  await user.type(start, "1.25");
  expect(screen.getByRole("button", { name: "Mark ready" })).toBeEnabled();
  await user.tab();
  expect(start.value).toBe("1.25");
  expect(screen.getByRole("button", { name: "Mark ready" })).toBeDisabled();
});
