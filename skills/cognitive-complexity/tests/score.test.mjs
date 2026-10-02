import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { scoreFile, scoreSource } from '../scripts/score.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, 'fixtures', name);
const SCRIPT = join(here, '..', 'scripts', 'score.mjs');

// Expected increments come from the fixture's own `// +N` comments, which are
// copied from the whitepaper. Every `+N` in a line's comment is summed.
function expectedByLine(path) {
  const expected = new Map();
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((text, i) => {
      const comment = text.split('//')[1];
      if (!comment) return;
      const sum = [...comment.matchAll(/\+(\d+)/g)].reduce((acc, m) => acc + Number(m[1]), 0);
      if (sum > 0) expected.set(i + 1, sum);
    });
  return expected;
}

function actualByLine(results) {
  const actual = new Map();
  for (const fn of results) {
    for (const inc of fn.increments) actual.set(inc.line, (actual.get(inc.line) ?? 0) + inc.increment);
  }
  return actual;
}

const scoresByName = (results) => Object.fromEntries(results.map((r) => [r.name, r.score]));
const score = (code, opts) => scoresByName(scoreSource(code, opts));

const WHITEPAPER = [
  ['whitepaper-intro.ts', { sumOfPrimes: 7, getWords: 1 }],
  ['whitepaper-rules.ts', { mixedSequences: 4, negatedGroup: 3, myMethod: 9, myMethod2: 2 }],
  ['whitepaper-appendix-a.js', { declarative: 0, 'bar.myFun': 1, nonDeclarative: 3 }],
  [
    'whitepaper-appendix-c.ts',
    { 'JavaSymbolResolver.overriddenSymbolFrom': 19, 'TimelyResource.addVersion': 35, toRegexp: 20 },
  ],
  ['whitepaper-yui.js', { save: 20 }],
];

for (const [file, totals] of WHITEPAPER) {
  test(`whitepaper example ${file}: per-line increments match the paper`, () => {
    const results = scoreFile(fixture(file));
    assert.deepEqual(actualByLine(results), expectedByLine(fixture(file)));
  });

  test(`whitepaper example ${file}: function totals match the paper`, () => {
    const scores = scoresByName(scoreFile(fixture(file)));
    for (const [name, total] of Object.entries(totals)) assert.equal(scores[name], total, name);
  });
}

test('null-coalescing, optional chaining and logical assignment are ignored', () => {
  assert.deepEqual(score('function f(a, b) { a ??= b; a ||= b; return a?.b ?? b; }'), { f: 0 });
});

test('`??` does not join or split && / || sequences', () => {
  assert.deepEqual(score('function f(a, b, c) { return a && (b ?? c) && b; }'), { f: 1 });
});

test('logical operators count outside conditions too', () => {
  assert.deepEqual(score('function f(a, b, c) { return a || b && c; }'), { f: 2 });
});

test('else if and else get no nesting increment', () => {
  const code = `function f(x) {
    for (const y of x) {
      if (y === 1) {} else if (y === 2) {} else {}
    }
  }`;
  // for +1, if +2 (nesting 1), else if +1, else +1
  assert.deepEqual(score(code), { f: 5 });
});

test('nested ternaries are nested structures', () => {
  assert.deepEqual(score('function f(a, b) { return a ? (b ? 1 : 2) : 3; }'), { f: 3 });
});

test('unlabelled break and continue are free', () => {
  assert.deepEqual(score('function f(xs) { for (const x of xs) { if (x) break; continue; } }'), { f: 3 });
});

test('a callback passed by a statement stays nested in its function', () => {
  const code = 'function f(xs) { xs.forEach((x) => { if (x) {} }); }';
  assert.deepEqual(score(code), { f: 2 });
});

test('factory functions that only declare things are scored per inner function', () => {
  const code = `export function createService(repo) {
    const find = async (id) => { if (!id) return null; return repo.get(id); };
    function save(item) { for (const x of item.parts) { if (x) repo.put(x); } }
    return { find, save };
  }`;
  assert.deepEqual(score(code), { createService: 0, find: 1, save: 3 });
});

test('a TypeScript `as` or `satisfies` around the returned object keeps a factory declarative', () => {
  const asCode = `function build(deps: Deps) {
    const { db } = deps;
    return { Query: { one: (id: string) => { if (!id) return null; return db.get(id); } } } as Resolvers;
  }`;
  assert.deepEqual(score(asCode), { build: 0, one: 1 });
  const satisfiesCode =
    'const build = (db: Db) => ({ one: (id: string) => (id ? db.get(id) : null) } satisfies Resolvers);';
  assert.deepEqual(score(satisfiesCode), { build: 0, one: 1 });
});

test('returning a call is not declarative, so its callbacks stay nested', () => {
  const code = `function load(id) {
    return fetchUser(id).then((user) => {
      if (!user) return null;
      return fetchOrders(user.id).then((orders) => { if (orders.length === 0) return []; return orders; });
    });
  }`;
  // if +2 (nesting 1), if +3 (nesting 2)
  assert.deepEqual(score(code), { load: 5 });
});

test('top-level callbacks are scored as their own functions', () => {
  const code = "app.get('/', (req, res) => { if (req.ok) res.send(); });";
  assert.deepEqual(score(code), { '<callback app.get>': 1 });
});

test('functions inside module-level control flow keep its nesting', () => {
  const code = "for (const x of cases) { test('t', () => { if (x) {} }); }";
  // module: for +1; callback: if +2 (nesting 1, from the module-level loop)
  assert.deepEqual(score(code), { '<module>': 1, '<callback test>': 2 });
});

test('module-level code is reported as <module>', () => {
  assert.deepEqual(score('const x = process.env.A ? 1 : 2;'), { '<module>': 1 });
});

test('direct recursion adds +1', () => {
  assert.deepEqual(score('function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }'), { fact: 2 });
});

test('recursion through a callback counts for the named function', () => {
  const code = 'const walk = (node) => { node.children.forEach((c) => walk(c)); };';
  assert.deepEqual(score(code), { walk: 1 });
});

test('indirect recursion adds +1 to every function in the cycle', () => {
  const code = `
    function isEven(n) { return n === 0 || isOdd(n - 1); }
    function isOdd(n) { return n !== 0 && isEven(n - 1); }
    function main() { return isEven(4); }`;
  assert.deepEqual(score(code), { isEven: 2, isOdd: 2, main: 0 });
});

test('this.method() recursion inside a class', () => {
  const code = `class Tree {
    depth(node) { return node ? 1 + this.depth(node.next) : 0; }
    size(list) { return list.size(); }
  }`;
  assert.deepEqual(score(code), { 'Tree.depth': 2, 'Tree.size': 0 });
});

test('parses JSX and TypeScript-only syntax', () => {
  const tsx = `export function List({ items }: { items: string[] }) {
    if (!items.length) return null;
    return <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>;
  }`;
  assert.deepEqual(score(tsx, { jsx: true }), { List: 1 });
  const ts = 'function f(x: unknown) { const n = <number>x; return n > 0 ? n : 0; }';
  assert.deepEqual(score(ts), { f: 1 });
});

test('reports a breakdown with line, kind and nesting', () => {
  const [fn] = scoreSource('function f(a) {\n  for (;;) {\n    if (a) {}\n  }\n}');
  assert.deepEqual(
    fn.increments.map(({ line, kind, increment, nesting }) => ({ line, kind, increment, nesting })),
    [
      { line: 2, kind: 'for', increment: 1, nesting: 0 },
      { line: 3, kind: 'if', increment: 2, nesting: 1 },
    ],
  );
});

// Expected --biome values were checked against Biome 2.5.14's noExcessiveCognitiveComplexity.
const biome = (code) => score(code, { biome: true });

test('--biome counts `??` runs like && and ||', () => {
  const code = 'function f(a, b, c) { const x = a ?? b; return [x ?? c, a ?? b ?? c]; }';
  assert.deepEqual(score(code), { f: 0 });
  assert.deepEqual(biome(code), { f: 3 });
});

test('--biome gives `else if` the nesting penalty, but not `else`', () => {
  const code = 'function f(xs, b) { for (const x of xs) { if (x) {} else if (b) {} else {} } }';
  // for +1, if +2, else if +1 (whitepaper) or +2 (Biome), else +1
  assert.deepEqual(score(code), { f: 5 });
  assert.deepEqual(biome(code), { f: 6 });
});

test('--biome counts finally like else', () => {
  const code = 'function f(a) { try { if (a) {} } catch { if (a) {} } finally { if (a) {} } }';
  // if +1, catch +1, if +2 (nesting 1), if +1; Biome adds finally +1
  assert.deepEqual(score(code), { f: 5 });
  assert.deepEqual(biome(code), { f: 6 });
});

test('--biome scores conditions one level deeper', () => {
  const code = 'function f(a, b, c) { if (a ? b : c) {} for (let i = a ? 1 : 2; i < (b ? 1 : 2); i++) {} }';
  // if +1, ?: +1 (whitepaper) or +2 (Biome); for +1, two ?: at +1 or +2 each
  assert.deepEqual(score(code), { f: 5 });
  assert.deepEqual(biome(code), { f: 8 });
});

test('--biome follows the expression tree for logical runs, and brackets start a new run', () => {
  assert.deepEqual(score('function f(a, b, c, d) { return a || b && c || d; }'), { f: 3 });
  assert.deepEqual(biome('function f(a, b, c, d) { return a || b && c || d; }'), { f: 2 });
  assert.deepEqual(score('function f(a, b, c) { return a && (b && c); }'), { f: 1 });
  assert.deepEqual(biome('function f(a, b, c) { return a && (b && c); }'), { f: 2 });
});

test('--biome scores nested functions separately, one level deeper', () => {
  const wrapper = 'function numberIn(units) { return (value) => { if (value) return; }; }';
  assert.deepEqual(score(wrapper), { numberIn: 0, '<anonymous>': 1 });
  assert.deepEqual(biome(wrapper), { numberIn: 0, '<anonymous>': 2 });
  const callback = 'function f(xs) { if (xs) {} xs.forEach((x) => { if (x) {} }); }';
  assert.deepEqual(score(callback), { f: 3 });
  assert.deepEqual(biome(callback), { f: 1, '<callback xs.forEach>': 2 });
});

const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

test('CLI prints a Markdown table: file, function, line, lines, score, top contributors', () => {
  const result = run(fixture('whitepaper-intro.ts'));
  assert.equal(result.status, 0);
  const rows = result.stdout.split('\n').filter((line) => line.startsWith('|'));
  assert.equal(rows[0], '| File | Function | Line | Lines | Score | Top contributors |');
  assert.match(
    rows[2],
    /^\| \S*whitepaper-intro\.ts \| sumOfPrimes \| 4 \| 12 \| 7 \| if \+3 \(L8\), for \+2 \(L7\), for \+1 \(L6\) \|$/,
  );
  assert.doesNotMatch(result.stdout, /```/);
});

test('CLI escapes | inside table cells', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-'));
  writeFileSync(join(dir, 'or.ts'), 'export function f(a: boolean, b: boolean) { return a || b; }');
  assert.match(run(dir).stdout, /\| 1 \| \\\|\\\| \+1 \(L1\) \|$/m);
});

test('CLI exits 1 and prints a breakdown when the threshold is exceeded', () => {
  const result = run('--threshold', '15', fixture('whitepaper-appendix-c.ts'));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\| TimelyResource\.addVersion \| \d+ \| \d+ \| 35 ✗ \|/);
  assert.match(result.stdout, /```\n\S+:\d+:\d+ {2}TimelyResource\.addVersion {2}35\n/);
  assert.match(result.stdout, /for\s+\+4 {2}\(nesting 3\)/);
  assert.match(result.stdout, /5 functions scored, 3 above 15/);
});

test('CLI exits 0 when everything is within the threshold', () => {
  const result = run('--threshold', '35', fixture('whitepaper-appendix-c.ts'));
  assert.equal(result.status, 0);
});

test('CLI --biome switches to Biome scoring', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-'));
  writeFileSync(join(dir, 'nullish.ts'), 'export function f(a?: number, b?: number) { return a ?? b; }');
  assert.match(run('--threshold', '0', dir).stdout, /0 above 0/);
  const result = run('--biome', '--threshold', '0', dir);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\| f \| 1 \| 1 \| 1 ✗ \|/);
});

test('CLI --json lists every function', () => {
  const result = run('--json', fixture('whitepaper-intro.ts'));
  assert.equal(result.status, 0);
  const rows = JSON.parse(result.stdout).map(({ name, line, lines, score }) => ({ name, line, lines, score }));
  assert.deepEqual(rows, [
    { name: 'sumOfPrimes', line: 4, lines: 12, score: 7 },
    { name: 'getWords', line: 17, lines: 12, score: 1 },
  ]);
});

test('CLI scans directories', () => {
  const result = run(join(here, 'fixtures'));
  assert.equal(result.status, 0);
  assert.match(result.stdout, /15 functions scored/);
});

test('CLI exits 2 on parse errors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-'));
  writeFileSync(join(dir, 'broken.ts'), 'function (');
  const result = run(dir);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /cannot parse .*broken\.ts/);
});
