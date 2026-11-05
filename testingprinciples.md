# Testing Principles

How agents (and humans) write tests in this repo. Enforced by the nightly
test-cleanup sweep. Linked from `AGENTS.md`.

- **Fewer, longer tests that walk a full user journey.** Combine single-assertion
  tests into flow tests. Modern test output handles many assertions without
  hurting debugging; many tiny tests just duplicate setup and slow the suite.
- **Never export a constant just to assert its value.**
- **Never pin exact error strings.** Assert behavior, not message text.
- **Temporary regression tests are allowed while iterating.** The nightly sweep
  removes them after they've served their purpose — don't suppress them upfront.
- **Keep the suite high-signal.** The nightly sweep deletes more lines than it
  adds and exits early when nothing changed in 24h.
