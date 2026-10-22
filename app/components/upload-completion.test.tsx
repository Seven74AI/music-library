/**
 * @vitest-environment jsdom
 */
import { type ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test, vi } from "vitest";
import { UploadCompletion } from "./upload-completion.tsx";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useFetcher: () => ({
      state: "idle",
      data: undefined,
      submit: vi.fn(),
      formData: undefined,
    }),
  };
});

function renderCompletion(tracks: ComponentProps<typeof UploadCompletion>["successfulTracks"]) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <UploadCompletion
            successfulTracks={tracks}
            failedFiles={[]}
            onRetryFailed={() => {}}
            onUploadMore={() => {}}
            onViewLibrary={() => {}}
          />
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

const exactTrack = {
  trackId: "new-track",
  fileName: "song.mp3",
  title: "New Upload",
  artist: "Uploader",
  exactDuplicate: {
    trackId: "original-track",
    title: "Original",
    artist: "Original Artist",
    confidence: 100,
  },
};

test("shows the real storage saved size for an exact duplicate", async () => {
  const user = userEvent.setup();
  renderCompletion([{ ...exactTrack, storageSavedBytes: 5 * 1024 * 1024 }]);

  await user.click(screen.getByRole("button", { name: /show details/i }));

  expect(screen.getByText("Storage saved:")).toBeInTheDocument();
  expect(screen.getByText("5 MB")).toBeInTheDocument();
  expect(screen.queryByText(/~\d+MB/)).not.toBeInTheDocument();
});

test("retry passes the failed files back to the caller", async () => {
  const user = userEvent.setup();
  const onRetryFailed = vi.fn();
  const failedFiles = [
    { fileId: "file-1", fileName: "empty.mp3", error: "File empty.mp3 is empty" },
  ];
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <UploadCompletion
            successfulTracks={[]}
            failedFiles={failedFiles}
            onRetryFailed={onRetryFailed}
            onUploadMore={() => {}}
            onViewLibrary={() => {}}
          />
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);

  await user.click(screen.getByRole("button", { name: /retry failed uploads/i }));

  expect(onRetryFailed).toHaveBeenCalledWith(failedFiles);
});

test("omits the storage saved row when the size is unknown", async () => {
  const user = userEvent.setup();
  renderCompletion([exactTrack]);

  await user.click(screen.getByRole("button", { name: /show details/i }));

  expect(screen.queryByText("Storage saved:")).not.toBeInTheDocument();
});
