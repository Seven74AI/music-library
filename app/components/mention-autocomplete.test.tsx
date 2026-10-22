/**
 * @vitest-environment jsdom
 */
import { useRef, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test } from "vitest";
import { MentionAutocomplete } from "./mention-autocomplete";

function Composer() {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState("");

  return (
    <div className="relative">
      <label htmlFor="new-note">Add a note</label>
      <textarea
        ref={textareaRef}
        id="new-note"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <MentionAutocomplete value={value} onChange={setValue} textareaRef={textareaRef} />
    </div>
  );
}

test("typing @ lists a curator and inserts the mention", async () => {
  const user = userEvent.setup();
  const router = createMemoryRouter(
    [
      { path: "/", element: <Composer /> },
      {
        path: "/api/curator/curators",
        loader: () => ({
          curators: [
            {
              id: "curator-2",
              username: "sonja",
              name: "Sonja McLaughlin",
              displayName: "Sonja McLaughlin",
            },
          ],
        }),
      },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);

  await user.type(screen.getByLabelText("Add a note"), "@");

  await user.click(await screen.findByRole("button", { name: /@sonja/ }));
  expect(screen.getByLabelText("Add a note")).toHaveValue("@sonja ");
});
