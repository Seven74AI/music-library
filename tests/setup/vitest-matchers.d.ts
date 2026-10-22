// Type declarations for vitest 5 + custom matchers
// This file overrides @testing-library/jest-dom's vitest types which use old signature
//
// TODO: Remove this file once @testing-library/jest-dom releases Vitest 5 support
// Current version (7.0.1) was released before Vitest 5 and uses the old Assertion<T> signature.
// Vitest 5 requires Assertion<R, T> with 2 type parameters.
// Check weekly: npm view @testing-library/jest-dom version
// Once updated, revert to: import '@testing-library/jest-dom/vitest'

import "vitest";

interface CustomMatchers<R = unknown> {
  // Custom app matchers
  toHaveRedirect(redirectTo: string | null): R;
  toHaveSessionForUser(userId: string): Promise<R>;
  toSendToast(toast: import("#app/utils/toast.server.ts").ToastInput): Promise<R>;

  // Common jest-dom matchers (not exhaustive - matchers work at runtime via expect.extend)
  toBeInTheDocument(): R;
  toBeVisible(): R;
  toBeChecked(): R;
  toBeDisabled(): R;
  toBeEnabled(): R;
  toBeEmptyDOMElement(): R;
  toBeInvalid(): R;
  toBeRequired(): R;
  toBeValid(): R;
  toContainElement(element: HTMLElement | SVGElement | null): R;
  toContainHTML(html: string): R;
  toHaveAccessibleDescription(description?: string | RegExp): R;
  toHaveAccessibleName(name?: string | RegExp): R;
  toHaveAttribute(attr: string, value?: string | RegExp | null): R;
  toHaveClass(...classNames: string[]): R;
  toHaveDisplayValue(value: string | RegExp | Array<string | RegExp>): R;
  toHaveFocus(): R;
  toHaveFormValues(values: Record<string, any>): R;
  toHaveStyle(css: string | Record<string, any>): R;
  toHaveTextContent(text: string | RegExp, options?: { normalizeWhitespace?: boolean }): R;
  toHaveValue(value: string | string[] | number | null): R;
  toBePartiallyChecked(): R;
  toHaveErrorMessage(message?: string | RegExp): R;
}

declare module "vitest" {
  // Match vitest 5's Assertion signature (2 type parameters)
  interface Assertion<R extends void | Promise<void> = void, T = any> extends CustomMatchers<R> {}
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}
