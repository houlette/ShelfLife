# ShelfLife — Claude guidelines

## Branching and PR workflow

- **Never commit directly to `main`.**
- For every piece of work, create a feature branch first:
  `git checkout -b feature/<short-description>`
- Commit work to the feature branch, then open a PR targeting `main`.
- Branch names should be lowercase with hyphens, e.g. `feature/reading-goals`, `fix/sparkline-width`.
