/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { CuratorNotes } from "./curator-notes";

const mocks = vi.hoisted(() => ({
  notesLoad: vi.fn(),
  createSubmit: vi.fn(),
  createState: "idle" as "idle" | "submitting" | "loading",
  createData: undefined as unknown,
  fetcherSlot: 0,
  notesData: undefined as { notes: Array<(typeof notes)[number]> } | undefined,
}));

const notes = [
  {
    id: "note-1",
    entityType: "track",
    entityId: "track-1",
    curator: {
      id: "user-1",
      username: "kody",
      name: "Kody",
      displayName: "Kody",
    },
    content: "First impression",
    mentions: [] as string[],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    replies: [] as Array<{
      id: string;
      entityType: string;
      entityId: string;
      curator: {
        id: string;
        username: string;
        name: string;
        displayName: string;
      };
      content: string;
      mentions: string[];
      createdAt: string;
      updatedAt: string;
      replies: [];
    }>,
  },
];

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  const React = await import("react");
  return {
    ...actual,
    useFetcher: () => {
      // CuratorNotes calls useFetcher for notes, then create. MentionAutocomplete
      // calls it afterwards. Remember the slot per hook instance, but return a
      // fresh object every render so the success effect's notesFetcher dep changes.
      const slotRef = React.useRef<number | null>(null);
      if (slotRef.current === null) {
        slotRef.current = mocks.fetcherSlot++;
      }
      const index = slotRef.current;
      if (index === 0) {
        return {
          state: "idle" as const,
          data: mocks.notesData,
          load: mocks.notesLoad,
          submit: vi.fn(),
        };
      }
      if (index === 1) {
        return {
          get state() {
            return mocks.createState;
          },
          get data() {
            return mocks.createData;
          },
          load: vi.fn(),
          submit: mocks.createSubmit,
        };
      }
      return {
        state: "idle" as const,
        data: undefined,
        load: vi.fn(),
        submit: vi.fn(),
      };
    },
  };
});

const props = {
  entityType: "track" as const,
  entityId: "track-1",
  currentUserId: "user-1",
};

function iconButton(iconName: string) {
  const button = screen
    .getAllByRole("button")
    .find((candidate) => candidate.innerHTML.includes(iconName));
  if (!button) {
    throw new Error(`Missing ${iconName} button`);
  }
  return button;
}

beforeEach(() => {
  mocks.notesLoad.mockReset();
  mocks.createSubmit.mockReset();
  mocks.createState = "idle";
  mocks.createData = undefined;
  mocks.fetcherSlot = 0;
  mocks.notesData = { notes };
});

test("keeps edit and reply open after a saved note when the list re-renders", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<CuratorNotes {...props} />);

  await user.type(screen.getByLabelText("Add a note"), "Late night listen");
  await user.click(screen.getByRole("button", { name: "Add Note" }));
  expect(mocks.createSubmit).toHaveBeenCalledWith(
    {
      entityType: "track",
      entityId: "track-1",
      content: "Late night listen",
    },
    {
      method: "POST",
      action: "/api/curator/notes",
      encType: "application/json",
    },
  );

  mocks.createData = { ok: true };
  rerender(<CuratorNotes {...props} />);

  expect(screen.getByLabelText("Add a note")).toHaveValue("");
  expect(mocks.notesLoad).toHaveBeenCalledTimes(1);
  expect(mocks.notesLoad).toHaveBeenCalledWith(
    "/api/curator/notes?entityType=track&entityId=track-1",
  );

  await user.click(iconButton("pencil-1"));
  expect(screen.getAllByRole("textbox")).toHaveLength(2);
  expect(screen.getAllByRole("textbox")[1]).toHaveValue("First impression");
  await user.type(screen.getAllByRole("textbox")[1]!, " stays");
  rerender(<CuratorNotes {...props} />);

  expect(screen.getAllByRole("textbox")).toHaveLength(2);
  expect(screen.getAllByRole("textbox")[1]).toHaveValue("First impression stays");
  expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  expect(mocks.notesLoad).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Reply" }));
  await user.type(
    screen.getAllByPlaceholderText("Type @ to mention a curator...")[1]!,
    "Still here",
  );
  rerender(<CuratorNotes {...props} />);

  expect(screen.getAllByPlaceholderText("Type @ to mention a curator...")).toHaveLength(2);
  expect(screen.getAllByPlaceholderText("Type @ to mention a curator...")[1]).toHaveValue(
    "Still here",
  );
  expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  expect(mocks.notesLoad).toHaveBeenCalledTimes(1);
});

test("deletes a reply and leaves the parent note", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("confirm", () => true);
  notes[0]!.replies = [
    {
      id: "reply-1",
      entityType: "track",
      entityId: "track-1",
      curator: notes[0]!.curator,
      content: "Only the reply should go",
      mentions: [],
      createdAt: "2026-01-01T00:01:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z",
      replies: [],
    },
  ];

  render(<CuratorNotes {...props} />);

  expect(screen.getByText("First impression")).toBeInTheDocument();
  expect(screen.getByText("Only the reply should go")).toBeInTheDocument();

  const trashButtons = screen
    .getAllByRole("button")
    .filter((button) => button.innerHTML.includes("trash"));
  await user.click(trashButtons[1]!);

  expect(mocks.createSubmit).toHaveBeenCalledWith(
    {},
    {
      method: "DELETE",
      action: "/api/curator/notes/reply-1",
    },
  );
  expect(screen.getByText("First impression")).toBeInTheDocument();
  notes[0]!.replies = [];
  vi.unstubAllGlobals();
});

test("resets an open reply when a new submission succeeds", async () => {
  const user = userEvent.setup();
  mocks.createData = { ok: true, id: "first" };
  const { rerender } = render(<CuratorNotes {...props} />);

  await user.click(screen.getByRole("button", { name: "Reply" }));
  await user.type(screen.getAllByPlaceholderText("Type @ to mention a curator...")[1]!, "A reply");

  mocks.createData = { ok: true, id: "second" };
  rerender(<CuratorNotes {...props} />);

  expect(screen.getAllByPlaceholderText("Type @ to mention a curator...")).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  expect(mocks.notesLoad).toHaveBeenCalledTimes(2);
});

test("reloads notes when the entity id changes and hides the previous entity", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<CuratorNotes {...props} />);

  expect(screen.getByText("First impression")).toBeInTheDocument();
  await user.type(screen.getByLabelText("Add a note"), "Draft for the first track");
  expect(mocks.notesLoad).not.toHaveBeenCalled();

  rerender(<CuratorNotes {...props} entityId="track-2" />);

  expect(screen.queryByText("First impression")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Add a note")).toHaveValue("");
  expect(mocks.notesLoad).toHaveBeenCalledTimes(1);
  expect(mocks.notesLoad).toHaveBeenCalledWith(
    "/api/curator/notes?entityType=track&entityId=track-2",
  );

  mocks.notesData = {
    notes: [
      {
        ...notes[0]!,
        id: "note-2",
        entityId: "track-2",
        content: "Second impression",
        replies: [],
      },
    ],
  };
  rerender(<CuratorNotes {...props} entityId="track-2" />);

  expect(screen.getByText("Second impression")).toBeInTheDocument();
  expect(screen.queryByText("First impression")).not.toBeInTheDocument();

  await user.type(screen.getByLabelText("Add a note"), "For the second track");
  await user.click(screen.getByRole("button", { name: "Add Note" }));
  expect(mocks.createSubmit).toHaveBeenCalledWith(
    {
      entityType: "track",
      entityId: "track-2",
      content: "For the second track",
    },
    {
      method: "POST",
      action: "/api/curator/notes",
      encType: "application/json",
    },
  );
});
