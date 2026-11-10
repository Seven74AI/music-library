/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { EditableText } from "./editable-text";

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
    textarea.blur();

    expect(onSave).toHaveBeenCalledWith("");
  });

  test("does not call onSave when cleared without allowEmpty", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(<EditableText value="Title" onSave={onSave} />);

    await user.click(screen.getByText("Title"));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    input.blur();

    expect(onSave).not.toHaveBeenCalled();
  });
});
