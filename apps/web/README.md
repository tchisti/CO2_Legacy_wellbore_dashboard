# apps/web

The Legacy Well Assessment app. Setup, commands, the reviewer profile, backup and the v2 migration
are in the [root README](../../README.md); operations in [`docs/runbook.md`](../../docs/runbook.md).

## Notes for working on the app

- **Static export.** `next.config.ts` sets `output: 'export'`: `pnpm build` writes `out/`, and there
  are no route handlers, server actions or dynamic segments. Detail pages read their ids from the
  query string, and every internal link goes through `lib/routes.ts` (`wellHref`, `wellReportHref`,
  `wellsHref`, `portfolioReportHref`). Nothing may touch IndexedDB while a page prerenders: the
  store opens in the browser (`lib/store/provider.tsx`).
- **Data access** goes through the `Store` interface (`lib/store/store.ts`); `LocalStore`
  (`lib/store/local-store.ts`, Dexie) is the Phase 1 adapter, and `lib/store/contract.ts` is the
  suite any adapter must pass. The domain schemas live in `@lwa/engine` (`packages/engine/src/domain.ts`).
- **e2e hooks.** With `NEXT_PUBLIC_E2E=1` (`pnpm build:e2e`, and `next dev` under Playwright) the
  app exposes `window.__lwa` (`lib/e2e-hooks.ts`) so tests can seed the store. A plain build drops
  that code; `pnpm check:no-e2e-hooks` fails if `out/` carries it, was built by `build:e2e`, or holds
  no scripts. CI runs it after the plain build. `pnpm e2e:static` builds with the hooks and runs
  Playwright against the export on port 3100; `pnpm e2e` uses `next dev`.
- **Tests.** `pnpm test` (Vitest, jsdom, `fake-indexeddb`) fails below the store's coverage gate
  (`vitest.config.mts`). The Playwright suites include `e2e/a11y.spec.ts` (axe on every route, both
  themes), `e2e/responsive.spec.ts` (390 px and 1024 px) and `e2e/perf.spec.ts` (500 wells).
- **Theme.** Light by default; dark only when the user picks it (`data-theme="dark"` on `<html>`,
  kept in localStorage). Colours are tokens in `app/globals.css`; the four rank colours are used
  for rank only. Reports (`app/report/*`) always render and print in the light palette.
- **shadcn/ui.** Components live in `components/ui`. After `shadcn add`, change any
  `import { cn } from "cn"` to `import { cn } from "@/lib/utils"` (see `AGENTS.md`).
