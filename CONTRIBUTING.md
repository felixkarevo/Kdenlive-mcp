# Contributing

## Development checks

Use Node.js 22+, Bun 1.3+, and Python 3.12. Before opening a pull request, run:

```shell
bun install --frozen-lockfile
bun run check
bun run docs:check
python -m pip install -e "apps/analysis-worker[dev]"
python -m ruff check apps/analysis-worker
bun run worker:check
```

Runtime changes also require `bun run capabilities`; rendering changes require the
spike smoke test documented in `docs/milestone-0.md`. MCP/release changes require
`bun run mcp:acceptance`; packaging changes require `bun run sbom` and a platform archive
from `bun run package:release --platform windows` or `linux`.

Do not commit private media, generated artifacts, bearer tokens, model files, or
runtime binaries. New dependencies require a license/provenance explanation.

## Changes and releases

Commits use Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `build:`,
`ci:`, `chore:`). Keep a commit focused on one roadmap subtask and include its ID
in the body when useful. Release Please converts conventional commits into the
changelog and release pull request.

Pull requests must state the validation performed and call out changes to project
semantics, external commands, licenses, or platform behavior.

By participating, contributors agree to [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
