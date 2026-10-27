# Architecture Decision Records

ADRs live in this directory with three-digit numbering (`001-…`), one file per decision named `NNN-<slug>.md`.

## Numbering notes

- **003** was `003-audio-worker-architecture.md` (Audio Worker Architecture, accepted). Deleted when audio download functionality was removed (ADR-004); the worker was later reintroduced as `app/features/audio-archive/` by ADR-011.
- **015** is the Queue Spine ADR (`015-queue-spine-architecture.md`). The unified offline middleware ADR (`039-unified-offline-middleware.md`, accepted 2026-07-30) was formerly misnumbered `0015` and stranded in a stray `docs/adr/` directory; it was moved here and renumbered **039** to avoid the collision and orphan directory.
