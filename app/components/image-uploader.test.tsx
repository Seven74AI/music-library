/**
 * @vitest-environment jsdom
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test } from "vitest";
import { ImageUploader } from "./image-uploader";

test("drops a typed image URL when the entity id changes", async () => {
  const user = userEvent.setup();
  let setEntityId = (_id: string) => {};
  const submissions: unknown[] = [];

  function Harness() {
    const [entityId, setCurrent] = useState("album-a");
    setEntityId = setCurrent;
    return (
      <>
        <ImageUploader
          entityType="album"
          entityId={entityId}
          currentImageUrl={entityId === "album-a" ? "images/a.jpg" : "images/b.jpg"}
        />
      </>
    );
  }

  const router = createMemoryRouter(
    [
      { path: "/", element: <Harness /> },
      {
        path: "/api/images/from-url",
        action: async ({ request }) => {
          submissions.push(await request.json());
          return { success: false, error: "stopped" };
        },
      },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);

  await user.click(screen.getByRole("button", { name: "From URL" }));
  await user.type(screen.getByLabelText("Image URL"), "https://example.com/album-a.jpg");

  await act(async () => {
    setEntityId("album-b");
  });

  expect(screen.getByRole("img", { name: "Current image" }).getAttribute("src")).toContain("b.jpg");
  expect(screen.queryByDisplayValue("https://example.com/album-a.jpg")).toBeNull();
  expect(screen.getByLabelText("Image URL")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Upload" }).hasAttribute("disabled")).toBe(true);
  expect(submissions).toEqual([]);

  await user.type(screen.getByLabelText("Image URL"), "https://example.com/album-b.jpg");
  await user.click(screen.getByRole("button", { name: "Upload" }));

  await waitFor(() => {
    expect(submissions).toHaveLength(1);
  });
  expect(submissions).toEqual([
    {
      url: "https://example.com/album-b.jpg",
      entityType: "album",
      entityId: "album-b",
    },
  ]);
});
