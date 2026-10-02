# Scoring rules

`scripts/score.mjs` implements the SonarSource whitepaper *Cognitive Complexity: a new way of measuring understandability*, v1.7 (G. Ann Campbell, 2023), <https://www.sonarsource.com/docs/CognitiveComplexity.pdf>. This file covers the rules as applied to TS/JS, the JS-specific choices, and how the scores compare with `eslint-plugin-sonarjs`.

## Increments

| Construct | Increment | Raises nesting for its body |
| --- | --- | --- |
| `if`, `? :` (ternary) | +1 **+ nesting** | yes |
| `switch` (all cases together) | +1 **+ nesting** | yes (cases) |
| `for`, `for...in`, `for...of`, `while`, `do...while` | +1 **+ nesting** | yes |
| `catch` | +1 **+ nesting** | yes |
| `else if`, `else` | +1 (no nesting increment) | yes |
| Each run of like logical operators: `&&` or `\|\|` | +1 | no |
| `break label`, `continue label` | +1 | no |
| Each function in a recursion cycle | +1 | no |
| Nested function or arrow | +0 | yes |

Free (no increment, no nesting): `try`, `finally`, plain `break`/`continue`, early `return`, `throw`, `??`, `?.`, `??=` / `||=` / `&&=`, the function itself.

"+ nesting" means the current nesting depth is added. At depth 0 an `if` costs 1; inside a loop inside an `if` it costs 3.

## Logical operator runs

The operators are flattened left to right, and each change of operator starts a new run:

```ts
a && b && c            // +1   one run
a && b || c            // +2   && then ||
a || b && c || d       // +3   ||, &&, ||
a && !(b && c)         // +2   the negation separates the inner run
a && (b ?? c) && d     // +1   ?? is an operand, not part of the run
```

Runs count everywhere: conditions, `return`, assignments, arguments, JSX.

## Worked example

```ts
function sumOfPrimes(max: number): number {
  let total = 0;
  OUT: for (let i = 1; i <= max; ++i) {  // +1
    for (let j = 2; j < i; ++j) {        // +2 (nesting 1)
      if (i % j === 0) {                 // +3 (nesting 2)
        continue OUT;                    // +1
      }
    }
    total += i;
  }
  return total;
}                                        // 7
```

The same logic with the inner loop extracted to `isPrime(i)` scores `sumOfPrimes` 3 (`for` +1, `if` +2) and `isPrime` 3 (`for` +1, `if` +2). The total is lower and no single function is hard to read.

All of the whitepaper's examples, including the 19-, 20- and 35-point ones from Appendix C, are in `tests/fixtures/` with the paper's annotations. The test suite checks every annotated line.

## Functions inside functions

The whitepaper scores a nested function or callback as part of the function that contains it, one nesting level deeper. So a handler like this scores 3 as a whole, not 1 + 1:

```ts
async function handle(items: Item[]) {
  if (items.length === 0) return;      // +1
  await Promise.all(items.map(async (item) => {
    if (item.skip) return;             // +2 (nesting 1: inside the callback)
    await save(item);
  }));
}
```

**Declarative wrappers** (whitepaper Appendix A, "JavaScript: Missing class structures"): a function whose top level holds only declarations is not scored as a unit. Declarations are `const`/`let`/`var`, function and class declarations, assignments, type declarations, and a `return` of an object, function, class or name (`return { find, cancel }`). It also must have no `if`, loop, `switch`, `catch` or ternary of its own. Each function declared inside it is scored on its own, at nesting 0. This covers factories and module patterns:

```ts
export function createOrderService(repo: Repo) {   // declarative: score 0
  const find = async (id: string) => { ... };      // scored as its own function
  function cancel(order: Order) { ... }            // scored as its own function
  return { find, cancel };
}
```

A statement like `items.forEach(...)` or `useEffect(...)` at the top level makes the outer function a normal one, and its callbacks are scored as part of it.

Callbacks at module level, such as `app.get('/', (req, res) => ...)` or `describe(...)`, are scored as their own functions and named `<callback app.get>`. Control flow outside any function is reported as `<module>`. A function defined inside module-level control flow keeps that nesting, as in the whitepaper's `#if` example. In a parametrized test such as `for (const x of cases) { test(..., () => { if (...) }) }`, the `if` scores +2.

## Recursion

The scorer resolves calls by name within one file: `foo()` resolves to a function or `const` named `foo`, and `this.foo()` to a method of the enclosing class. It finds cycles, both direct and indirect (`isEven` ↔ `isOdd`), and adds +1 to each function in a cycle. A call made inside an anonymous callback counts for the named function around it. Known gaps: cycles across files, calls through object properties or aliases, and names declared more than once in a file (those are skipped).

## Compared with eslint-plugin-sonarjs

Checked against `eslint-plugin-sonarjs` 4.2.2 (`sonarjs/cognitive-complexity`). About 3,900 real-world TS/TSX functions were compared, chosen with no callbacks, `||` runs or recursion. The scores matched everywhere except JSX short-circuits and functions defined inside module-level loops. The two differ in these cases, and in each one this scorer's score is the higher one:

| Case | This scorer (whitepaper) | sonarjs 4.x |
| --- | --- | --- |
| `\|\|` runs (`a \|\| b`) | +1 per run | not counted (only `&&` runs count) |
| JSX short-circuit `{cond && <X/>}` | +1 per run | not counted |
| Callbacks and nested functions | part of the enclosing function, one level deeper | each function scored on its own, nesting reset |
| Recursion | +1 per function in a cycle | not counted |
| Function inside module-level `for`/`if` | keeps the module-level nesting | nesting starts at 0 |

So a function within the limit here is within it for sonarjs too. A function the scorer flags may still pass sonarjs, typically because of callbacks or `||` defaults. If the project's CI uses sonarjs, mention this when reporting scores.

## Compared with Biome: `--biome`

Biome's `noExcessiveCognitiveComplexity` departs from the whitepaper in several places, mostly scoring higher. `--biome` scores the way Biome does:

| Case | Whitepaper (default) | Biome, and `--biome` |
| --- | --- | --- |
| `??` (`a ?? b`) | not counted | +1 per run, like `&&` and `\|\|` |
| Logical runs | +1 each time the operator changes, reading left to right | +1 per operator that doesn't continue its parent's run in the expression tree; brackets start a new run: `a && (b && c)` = 2, `a \|\| b && c \|\| d` = 2 |
| Condition of `if`, `else if`, loops (whole `for (...)` head), `switch`, ternary | same nesting as the structure | one level deeper: `if (a ? b : c)` = 3 |
| `else if` | +1 | +1 plus nesting |
| `finally` | not counted | +1, like `else` |
| Callbacks and nested functions | part of the enclosing function, one level deeper | scored on their own, still one level deeper |
| Function returned by a declarative wrapper (`return (value) => { ... }`) | scored on its own, nesting 0 | one level deeper |

Checked against Biome 2.5.14: 53 probe functions (one or more per construct) all match exactly. Of 733 real functions from four TS repositories, 721 match exactly and the other 12 score higher here, never lower. The higher ones come from recursion (Biome doesn't count it), functions inside module-level code, and a Biome quirk that `--biome` deliberately doesn't copy: after a plain `else`, Biome scores later structures in the same block one level shallower. So in a Biome project, a function within the limit with `--biome` is within it for Biome too.

## Reported locations

Each increment is reported at the construct's keyword: `if`, `for`, `catch`, the `else` keyword, the `?` of a ternary, the operator that starts a logical run, the first recursive call. Columns are 1-based.
