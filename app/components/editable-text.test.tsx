/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { EditableText } from "./editable-text";

function getCheckButton() {
  return screen.getAllByRole("button")[0]!;
}

function getCancelButton() {
  return screen.getAllByRole("button")[1]!;
}

describe("EditableText allowEmpty", () => {
  test("clearing the description submits an empty string when allowEmpty is set", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <EditableText
        value="My playlist description"
        onSave={onSave}
        allowEmpty
        multiline
        placeholder="Add a description..."
      />,
    );

    await user.click(screen.getByText("My playlist description"));

    const textarea = screen.getByRole("textbox");
    await user.clear(textarea);
    await user.click(getCheckButton());

    expect(onSave).toHaveBeenCalledWith("");
  });

  test("does not call onSave when cleared without allowEmpty", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(<EditableText value="Title" onSave={onSave} />);

    await user.click(screen.getByText("Title"));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.click(getCheckButton());

    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("EditableText save and discard", () => {
  test("clicking cancel discards the edit and does not call onSave", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(<EditableText value="Original" onSave={onSave} />);

    await user.click(screen.getByText("Original"));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "Changed text");
    await user.click(getCancelButton());

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Original")).toBeInTheDocument();
  });

  test("check button saves at most once per click", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(<EditableText value="Original" onSave={onSave} />);

    await user.click(screen.getByText("Original"));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "Saved value");
    await user.click(getCheckButton());

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("Saved value");
  });
});
