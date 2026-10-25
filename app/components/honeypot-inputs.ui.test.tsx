/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { HoneypotProvider } from "remix-utils/honeypot/react";
import { expect, test } from "vitest";
import { HoneypotInputs } from "./honeypot-inputs.tsx";

test("honeypot fields are hidden by a stylesheet class and do not inject a style tag", () => {
  const { container } = render(
    <HoneypotProvider
      nameFieldName="name__confirm"
      validFromFieldName="from__confirm"
      encryptedValidFrom="encrypted"
    >
      <HoneypotInputs />
    </HoneypotProvider>,
  );

  const wrap = container.querySelector("#name__confirm_wrap");
  expect(wrap).toHaveClass("hidden");
  expect(wrap?.querySelector("style")).toBeNull();
  expect(screen.getAllByLabelText("Please leave this field blank")).toHaveLength(2);
});
