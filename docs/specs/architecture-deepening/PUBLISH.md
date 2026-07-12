## Published (2026-07-12)

| Issue | Title |
|-------|-------|
| [#46](https://github.com/mnlamart/music-library/issues/46) | Spec: Architecture deepening — six module refactors |
| [#47](https://github.com/mnlamart/music-library/issues/47) | Service connection module |
| [#48](https://github.com/mnlamart/music-library/issues/48) | Storage merge + unified audio object keys |
| [#49](https://github.com/mnlamart/music-library/issues/49) | Audio format domain module |
| [#50](https://github.com/mnlamart/music-library/issues/50) | Offline app module |
| [#51](https://github.com/mnlamart/music-library/issues/51) | Track audio ingest module (blocked by #48) |
| [#52](https://github.com/mnlamart/music-library/issues/52) | Service playlist + user library (blocked by #47) |

---

## Publish (if re-running)

From repo root, after `gh auth login`:

```bash
SPEC="docs/specs/architecture-deepening.md"
REPO="mnlamart/music-library"

# Parent tracking issue (spec pointer — optional but useful)
gh issue create --title "Spec: Architecture deepening — six module refactors" \
  --label "ready-for-agent" \
  --body "$(cat <<EOF
Parent spec for six module refactors (locality + test seams).

**Spec file:** [\`$SPEC\`](https://github.com/$REPO/blob/main/$SPEC)

## Child issues (create below, then paste numbers here)

| # | Title | Blocked by |
|---|-------|------------|
| 1 | Service connection module | — |
| 2 | Storage merge + unified audio object keys | — |
| 3 | Track audio ingest module | #2 |
| 4 | Audio format domain module | — |
| 5 | Service playlist + user library modules | #1 |
| 6 | Offline app module | — |

Implementation order: 1 → 2 → 3 → (4 parallel) → 5 → (6 parallel)
EOF
)"

# Or create the six implementation issues directly:
for f in docs/specs/architecture-deepening/issues/*.md; do
  title=$(head -1 "$f" | sed 's/^# Issue [0-9]*: //')
  gh issue create --title "$title" --label "ready-for-agent" --body-file "$f"
done
```

After creating issues, edit bodies to replace `#1` / `#2` with real GitHub issue numbers for blocking links.

## Suggested dependency links (GitHub)

- Issue 5 blocked by Issue 1
- Issue 3 blocked by Issue 2