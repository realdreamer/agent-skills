# Jest and Vitest

## Running one file once

| | Vitest | Jest |
| --- | --- | --- |
| Run a file | `npx vitest run path/to/file.test.ts` | `npx jest path/to/file.test.ts` |
| Through the project script | `npm test -- run path/to/file` if `test` is `vitest` | `npm test -- path/to/file` |
| One test by name | `-t "shows an error"` | `-t "shows an error"` |

Plain `vitest` starts watch mode and never exits; use `vitest run` when running from an agent.

## API mapping

| Purpose | Vitest | Jest |
| --- | --- | --- |
| Globals | imported from `vitest`, unless `globals: true` | global |
| Mock function | `vi.fn()` | `jest.fn()` |
| Spy | `vi.spyOn(obj, 'm')` | `jest.spyOn(obj, 'm')` |
| Mock a module | `vi.mock('./mod', () => ({...}))` | `jest.mock('./mod', () => ({...}))` |
| Keep the rest of a module real | `vi.mock('./mod', async (orig) => ({ ...(await orig()), fn: vi.fn() }))` | `jest.mock('./mod', () => ({ ...jest.requireActual('./mod'), fn: jest.fn() }))` |
| Variables used in a mock factory | `const { push } = vi.hoisted(() => ({ push: vi.fn() }))` | name starts with `mock`: `const mockPush = jest.fn()` |
| Typed mock | `vi.mocked(fn)` | `jest.mocked(fn)` |
| Fake timers | `vi.useFakeTimers()` | `jest.useFakeTimers()` |
| Fixed "now" | `vi.setSystemTime(new Date('2026-01-15T10:00:00Z'))` | `jest.setSystemTime(...)` |
| Advance time | `vi.advanceTimersByTime(300)` | `jest.advanceTimersByTime(300)` |
| Stub a global | `vi.stubGlobal('fetch', fn)` | `jest.spyOn(global, 'fetch')` |
| Expected failure | `it.fails` | `test.failing` |

Module mocks are hoisted above imports in both runners, so a factory can't use variables declared normally in the file; use the patterns in the table.

Vitest runs native ESM: `vi.spyOn` on an imported module namespace (`import * as mod`) can fail because ESM namespaces are not writable. That spy was usually checking an implementation detail anyway; mock the boundary instead.

## Keeping tests independent

Set mock cleanup in the config so no test sees another's mock state:

- Vitest: `test: { restoreMocks: true }` (or `mockReset`, `unstubGlobals: true`)
- Jest: `restoreMocks: true`

Without it, call `vi.restoreAllMocks()` / `jest.restoreAllMocks()` in `afterEach`. Global assignments (`global.fetch = ...`) outlive the test unless restored.

React Testing Library unmounts after each test automatically when the runner exposes a global `afterEach`. With Vitest and `globals: false`, add `afterEach(cleanup)` to the setup file.

## Environments

- Components and hooks: `jsdom` (or `happy-dom` in Vitest).
- Server code (route handlers, server actions, plain Node modules): `node`.
- Per file: `// @vitest-environment node` or `/** @jest-environment node */` at the top.
- jest-dom matchers: `import '@testing-library/jest-dom/vitest'` in the Vitest setup file, `import '@testing-library/jest-dom'` in Jest's `setupFilesAfterEnv`.

## Time

```ts
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-15T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());
```

With `user-event` and fake timers, pass the runner's clock so typing doesn't hang: `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` (Jest: `jest.advanceTimersByTime`).

For debounce and throttle, advance to just before the delay (nothing happened) and then past it (it happened). Both sides of the boundary are behaviors.

Prefer a `now` parameter on pure functions over fake timers when the code is yours to shape; it keeps the test plain.

## Mutation testing (Stryker)

Stryker makes small edits to the source (mutants) and runs the tests against each. A mutant that survives is a behavior change no test noticed. It automates the sabotage check.

Only run it if the project already has it (`@stryker-mutator/core` in `package.json` or a `stryker.config.*` file); installing it is the user's call. To set it up:

```bash
npm i -D @stryker-mutator/core @stryker-mutator/vitest-runner   # or @stryker-mutator/jest-runner
```

```json
// stryker.config.json
{ "testRunner": "vitest", "reporters": ["clear-text", "progress"] }
```

Run on the files in scope only:

```bash
npx stryker run --mutate "src/lib/cart.ts"
```

Report each surviving mutant as a missing or weak test: the location, the mutation (`>=` → `>`), and which behavior it reveals. Equivalent mutants (a mutation that doesn't change behavior) are noted, not chased.
