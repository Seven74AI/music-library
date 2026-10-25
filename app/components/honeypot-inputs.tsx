import { HoneypotInputs as RemixHoneypotInputs } from "remix-utils/honeypot/react";

/**
 * remix-utils hides these fields with an injected `<style>` block. Production
 * CSP allows stylesheets from this origin only (`style-src-elem 'self'`), so
 * that block never applies and "Please leave this field blank" shows on every
 * public form. A non-default className skips the injected style. Tailwind's
 * `hidden` class lives in the same-origin stylesheet.
 */
export function HoneypotInputs() {
  return <RemixHoneypotInputs className="hidden" />;
}
