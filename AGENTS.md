# Repository Guidelines

## Project Structure & Module Organization

This repository contains the Electron foundation and its design baselines. Treat these as authoritative:

- `docs/product/PRD.md`: product and UX.
- `docs/architecture/SPEC.md`: architecture and protocols.
- `docs/data/DATABASE_SCHEMA.md`: canonical data model.
- `docs/architecture/`: accepted architectural decisions.
- `knowledge/`: versioned ontology and methodology content.
- `references/`: raw research sources; never treat them as executable rules.

Implemented code lives in `apps/desktop/` and `packages/{shared,domain,ontology,application,db,experience}/`. Add future packages only when a real vertical slice uses them. Keep E2E tests in `tests/e2e/` and fixtures separate from production assets.

## Architecture Rules

Preserve the frozen boundaries: Workbench owns state, Agent owns reasoning, Human owns final judgment, ACP controls agents, and MCP exposes capabilities. Follow ADR-001 through ADR-003. Ontology defines shared meaning; methodology defines assessment rules; evidence constrains judgment; RAG retrieves but never scores. The renderer uses typed IPC only; never allow renderer or Agent direct SQLite access.

## Build, Test, and Development Commands

- `pnpm dev`: run the Electron development app.
- `pnpm build`: create main, preload, and renderer output.
- `pnpm typecheck`: check every workspace under strict TypeScript.
- `pnpm lint` / `pnpm format`: lint and verify formatting.
- `pnpm test`: run Vitest domain, repository, IPC, ontology, and UI tests.
- `pnpm test:e2e`: build and verify the Electron persistence flow.

## Coding Style & Naming Conventions

Use TypeScript with two-space indentation. Prefer explicit domain names such as `DiagnosisProposal`, `StateSnapshot`, and `SchoolStateExperience`. Use PascalCase for types/components, camelCase for functions and variables, and kebab-case for package directories. Validate external inputs with Zod and keep renderer access behind typed IPC.

## Testing Guidelines

Use Vitest for domain and service tests, React Testing Library for UI behavior, and Playwright for vertical flows. Name tests `*.test.ts(x)` and E2E tests `*.spec.ts`. Prioritize authorization recovery, evidence registration, diagnosis review, state commits, and cross-school isolation.

## Commit & Pull Request Guidelines

Git history is not present, so no repository-specific convention can be inferred. Use concise imperative commits, preferably Conventional Commits (for example, `feat(domain): add diagnosis proposal validation`). Pull requests should state the affected frozen requirement, summarize tests, disclose schema or protocol changes, and include screenshots for visible UX changes.
