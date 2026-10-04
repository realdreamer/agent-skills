# agent-skills

Agent skills (`SKILL.md` format) for TypeScript and JavaScript developers. They work with Claude Code, and with any agent that loads `SKILL.md` skills.

Each skill here:

- **computes instead of guessing.** Deterministic work runs in a small script, so the model doesn't have to estimate it.
- **is tested.** Scripts have unit tests; skills ship eval prompts for triggering and output quality.
- **is auditable.** Plain JavaScript, no network calls, no install hooks, few dependencies. Read it before you install it.

## Skills

| Skill | What it does |
|---|---|
| [`cognitive-complexity`](skills/cognitive-complexity/SKILL.md) | Keeps TS/JS functions under a Cognitive Complexity limit while writing code. Explains a function's score line by line, refactors it with before → after scores, and audits changed files or a folder. Scores come from a bundled scorer that implements the SonarSource whitepaper. |
| [`unit-testing-js-ts-react-nextjs`](skills/unit-testing-js-ts-react-nextjs/SKILL.md) | Writes and reviews behavior-first unit tests for JS/TS, React and Next.js with Jest, Vitest and React Testing Library. Writes tests for a file, a commit, a branch or a PR; reviews existing tests against the four pillars of a good unit test. Proves each test can fail with a sabotage check instead of trusting coverage. |

## Install

### Claude Code (plugin)

```
/plugin marketplace add realdreamer/agent-skills
/plugin install cognitive-complexity@realdreamer
/plugin install unit-testing-js-ts-react-nextjs@realdreamer
```

Claude Code installs the scorer's npm dependencies automatically when it installs the plugin.

### Codex and other agents

```bash
npx skills@latest add realdreamer/agent-skills
```

Pick the skills and the agents to install them on. Each skill ships an `agents/openai.yaml` with its display name in Codex. For `cognitive-complexity`, install the scorer's dependencies once afterwards (see below).

### Any agent (copy the folder)

Copy `skills/cognitive-complexity/` into your agent's skills directory (for Claude Code: `~/.claude/skills/` or `.claude/skills/` in a project). Then install the scorer's dependencies once:

```bash
npm ci --prefix path/to/skills/cognitive-complexity
```

If you skip this step, the scorer prints this exact command the first time it runs.

## cognitive-complexity

[Cognitive Complexity](https://www.sonarsource.com/docs/CognitiveComplexity.pdf) measures how hard a function's control flow is to read: +1 for each `if`, loop, `catch`, ternary, `else` or run of `&&`/`||`, plus +1 for every level of nesting it sits in. The skill targets **≤ 10** per function for new code, with a hard limit of **15**. A limit configured in your project wins.

The agent uses it to:

- **write** new functions that stay flat: guard clauses, extracted helpers, lookup maps, named conditions.
- **explain** a score: "why is this function complex?" gets a line-by-line breakdown.
- **refactor** a function under the limit and report `before → after`, under a behaviour lock: literals, signatures and error handling stay exactly as they are, and suspected bugs are reported, not fixed.
- **audit** changed files or a folder and list the offenders.

Two design choices come from research on refactoring with LLMs. Saha et al. ([EASE 2026, arXiv:2603.16791](https://arxiv.org/abs/2603.16791)) found that unconstrained LLM refactors raised cognitive complexity about as often as they lowered it. Most failures were behaviour "improvements": a sum function changed into an average, `3.14` replaced with `π`, validation added. Explicit constraints cut those failures by 54–71%. So the skill measures every refactor with the scorer instead of trusting it, and it spells out the behaviour lock. Their study used small Python programs, but those failure types show up in TS refactors too.

### The scorer

The scorer also works without an agent, for example in CI:

```console
node scripts/score.mjs --threshold 15 evals/files
```

| File | Function | Line | Lines | Score | Top contributors |
| --- | --- | ---: | ---: | ---: | --- |
| evals/files/order-handler.ts | handler | 6 | 43 | 32 ✗ | if +4 (L24), ?: +4 (L34), if +3 (L23) |
| evals/files/readings.ts | summarizeReadings | 7 | 29 | 29 ✗ | if +5 (L19), if +4 (L12), for...of +4 (L18) |
| evals/files/inventory.ts | syncInventory | 3 | 33 | 26 ✗ | if +6 (L25), for...of +4 (L8), if +4 (L16) |

```
evals/files/order-handler.ts:6:24  handler  32
    8:5      if               +1
    12:5     if               +1
    12:27    ||               +1
    ...
    24:11    if               +4  (nesting 3)
    ...
```

…then the same breakdown for the other two functions, and `5 functions scored, 3 above 15`.

(`evals/files/` holds the skill's eval inputs.) The output is a Markdown table, so it renders as a table when an agent shows it in chat or a PR comment.

| Flag | Effect |
| --- | --- |
| `--threshold <n>` | Flags functions above `n`, prints their breakdown, exits `1` |
| `--explain` | Prints the breakdown for every function |
| `--json` | Prints machine-readable output, including functions that score 0 |
| `--biome` | Scores like Biome's `noExcessiveCognitiveComplexity`, which counts `??`, `finally` and some nesting that the whitepaper doesn't |

Exit codes: `0` ok, `1` threshold exceeded, `2` usage or parse error. Directories are scanned recursively, skipping `node_modules`, `dist`, `build`, `cdk.out`, `.aws-sam` and similar.

### How accurate is it?

- The test suite contains every example from the SonarSource whitepaper (v1.7), including the 19-, 20- and 35-point examples from Appendix C. Each one matches the paper line by line.
- On about 3,900 real-world TS/TSX functions it was compared with `eslint-plugin-sonarjs`. Scores matched wherever both tools follow the same rules.
- It follows the whitepaper where `sonarjs` departs from it. It counts `||` runs, JSX `{cond && <X/>}`, recursion, and callbacks as part of their enclosing function. Scores are therefore equal to or higher than `sonarjs`, so code that passes here passes `sonarjs` too.
- Biome's `noExcessiveCognitiveComplexity` departs from the whitepaper in several places. With `--biome`, 721 of 733 real-world functions matched Biome exactly and the rest scored higher, never lower. Details: [scoring-rules.md](skills/cognitive-complexity/references/scoring-rules.md).

Dependencies: `@typescript-eslint/typescript-estree` and `typescript`, pinned in the lockfile.

## unit-testing-js-ts-react-nextjs

Tests are judged by whether they go red when a behavior breaks, not by coverage. The *user* of a unit is whoever consumes it: a person for a component, the calling code for a module, an HTTP client for a route handler. Tests act the way that user does.

The agent uses it to:

- **write** tests for a module, component, hook, route handler or server action. It builds a behavior inventory from the public interface first (happy path, boundaries, failures, state over time, permissions, time), then writes tests through that interface, mocking only at the boundaries.
- **write tests for a change**: a commit, a branch, a PR or uncommitted work. It splits the diff into behavior changes, adds a regression test for each bug fix, and leaves pure refactors to the existing tests.
- **review** existing tests: a rating on each of the four pillars, findings with `file:line` and a smell ID from a catalog of 22, the behaviors that are missing or only weakly covered, and a rewrite of the worst test.

Instead of trusting a test because it passes, the skill runs a **sabotage check**: it breaks the behavior in the source, confirms the test goes red, and restores the source. Where the project already uses [Stryker](https://stryker-mutator.io/), it runs mutation testing on the files in scope instead.

The rules come from:

- Vladimir Khorikov, *Unit Testing Principles, Practices, and Patterns*: the four pillars (protection against regressions, resistance to refactoring, fast feedback, maintainability), observable behavior vs implementation details, and mocking only unmanaged dependencies.
- Kent C. Dodds and [Testing Library's guiding principle](https://testing-library.com/docs/guiding-principles): tests that resemble how the software is used, and query priority by accessibility.
- Kent Beck's [Test Desiderata](https://testdesiderata.com/), and Ian Cooper's "TDD, where did it all go wrong": a new behavior, not a new method, is what earns a new test.
- *Software Engineering at Google*, chapters 11–14: test behaviors via public APIs, prefer state over interaction verification, DAMP over DRY.

Next.js coverage follows the official [Vitest](https://nextjs.org/docs/app/guides/testing/vitest) and [Jest](https://nextjs.org/docs/app/guides/testing/jest) guides, including their limit: `async` Server Components are left to E2E tests, and their logic is extracted into functions the skill can unit test.

## Repository layout

```
.claude-plugin/marketplace.json     one plugin per skill
skills/<name>/
  SKILL.md                          what the agent reads first (kept short)
  references/                       detail the agent loads on demand
  scripts/                          deterministic tools
  tests/                            script tests (node --test)
  evals/                            evals.json (task evals) + trigger-evals.json
  package.json, package-lock.json   script dependencies
biome.json, package.json            repo-wide lint and format
```

## Development

Node 24 (see `.nvmrc`) and npm. Each skill keeps its own `package.json` and `package-lock.json`, because that is what users and Claude Code install from.

```bash
nvm use
npm ci                                       # Biome, for the whole repo
npm ci --prefix skills/cognitive-complexity  # the scorer's dependencies
npm run check                                # lint + format check (Biome)
npm run fix                                  # apply formatting and safe fixes
npm test
```

CI (`.github/workflows/ci.yml`) runs the same check, the tests on Node 20, 22 and 24, and `claude plugin validate .` on every push to `main` and every pull request.

Biome skips `tests/fixtures/` and `evals/files/`: the fixtures are whitepaper code checked line by line, and the eval inputs are complex on purpose.

`evals/` follows the format of Anthropic's [`skill-creator`](https://github.com/anthropics/skills) skill. `evals.json` holds task prompts with expectations, run with and without the skill. `trigger-evals.json` holds prompts that should and should not trigger the skill, for tuning its description.

## License

[MIT](LICENSE)
