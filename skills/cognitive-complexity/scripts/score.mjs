#!/usr/bin/env node
// Cognitive Complexity scorer for TypeScript/JavaScript.
//
// Implements the SonarSource Cognitive Complexity whitepaper (v1.7, 2023):
// https://www.sonarsource.com/docs/CognitiveComplexity.pdf
// See ../references/scoring-rules.md for the rules and the places where this
// tool and the eslint-plugin-sonarjs rule disagree.
//
// No network access, no file writes. Reads the files you pass and prints scores.

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

let parse;
try {
  ({ parse } = await import('@typescript-eslint/typescript-estree'));
} catch {
  console.error(
    'score.mjs: missing dependency @typescript-eslint/typescript-estree.\n' +
      `Install it once with: npm ci --prefix "${SKILL_DIR}"`,
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const LOOP_LABELS = {
  ForStatement: 'for',
  ForInStatement: 'for...in',
  ForOfStatement: 'for...of',
  WhileStatement: 'while',
  DoWhileStatement: 'do...while',
};
// Structures that get a structural increment (and so make a function non-declarative).
const STRUCTURAL_TYPES = new Set([
  'IfStatement',
  'ConditionalExpression',
  'SwitchStatement',
  'CatchClause',
  ...Object.keys(LOOP_LABELS),
]);
const SKIP_KEYS = new Set(['parent', 'loc', 'range', 'tokens', 'comments']);

function isNode(value) {
  return value !== null && typeof value === 'object' && typeof value.type === 'string';
}

function nodesIn(value) {
  if (Array.isArray(value)) return value.filter(isNode);
  return isNode(value) ? [value] : [];
}

function* childNodes(node) {
  for (const key of Object.keys(node)) {
    if (!SKIP_KEYS.has(key)) yield* nodesIn(node[key]);
  }
}

function walk(node, fn) {
  fn(node);
  for (const child of childNodes(node)) walk(child, fn);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

// Node type -> Scorer method. Everything else just visits its children.
const VISITORS = {
  IfStatement: 'visitIf',
  ConditionalExpression: 'visitConditional',
  SwitchStatement: 'visitSwitch',
  TryStatement: 'visitTry',
  CatchClause: 'visitCatch',
  BreakStatement: 'visitJump',
  ContinueStatement: 'visitJump',
  LogicalExpression: 'visitLogical',
  ...Object.fromEntries(Object.keys(LOOP_LABELS).map((type) => [type, 'visitLoop'])),
  ...Object.fromEntries([...FUNCTION_TYPES].map((type) => [type, 'visitFunction'])),
};

/**
 * Score every function in a source string.
 * @param {string} code
 * @param {{ jsx?: boolean, biome?: boolean }} [options] `biome` scores like Biome's
 *   noExcessiveCognitiveComplexity where it is stricter than the whitepaper.
 * @returns {Array<{name: string, line: number, column: number, score: number, increments: Array}>}
 */
export function scoreSource(code, { jsx = false, biome = false } = {}) {
  const ast = parse(code, { jsx, loc: true, range: true, loggerFn: false });
  return new Scorer(code, ast, { biome }).run();
}

// Visit methods take (node, nesting, ctx). `ctx.unit` is the function being
// scored. With `ctx.promote`, a function met here becomes its own reported unit
// instead of adding to the current one (module scope, or a declarative wrapper).
class Scorer {
  constructor(code, ast, { biome }) {
    this.code = code;
    this.ast = ast;
    this.biome = biome;
    this.parents = new Map();
    walk(ast, (node) => {
      for (const child of childNodes(node)) this.parents.set(child, node);
    });
    this.lineStarts = computeLineStarts(code);
    this.recursion = findRecursion(ast, this.parents, (offset) => this.position(offset));
    this.declarative = new Map();
    this.units = [];
  }

  run() {
    const moduleUnit = this.newUnit('<module>', { line: 1, column: 1 }, this.lineStarts.length);
    this.visitChildren(this.ast, 0, { unit: moduleUnit, promote: true });
    return this.units.filter((unit) => unit !== moduleUnit || unit.increments.length > 0).map(finishUnit);
  }

  newUnit(name, { line, column }, lines) {
    const unit = { name, line, column, lines, increments: [] };
    this.units.push(unit);
    return unit;
  }

  position(offset) {
    return offsetToPosition(this.lineStarts, offset);
  }

  // Structural increments (+1 + nesting) when `structural`, otherwise +1.
  // `offset` points the report at a token such as `?` or `else`.
  add(unit, kind, node, nesting, structural, offset) {
    const { line, column } = offset === undefined ? startOf(node) : this.position(offset);
    const depth = structural ? nesting : 0;
    unit.increments.push({ line, column, kind, increment: 1 + depth, nesting: depth });
  }

  tokenAfter(token, from) {
    return tokenOffset(this.code, token, from);
  }

  visit(node, nesting, ctx) {
    const method = VISITORS[node.type];
    if (method) return this[method](node, nesting, ctx);
    this.visitChildren(node, nesting, ctx);
  }

  visitChildren(node, nesting, ctx) {
    for (const child of childNodes(node)) this.visit(child, nesting, ctx);
  }

  visitIf(node, nesting, ctx) {
    this.add(ctx.unit, 'if', node, nesting, true);
    this.visitBranches(node, nesting, ctx);
  }

  // `else if` and `else` are hybrid increments: +1, no nesting penalty.
  // Biome gives `else if` the nesting penalty.
  visitBranches(node, nesting, ctx) {
    this.visit(node.test, this.conditionNesting(nesting), ctx);
    this.visit(node.consequent, nesting + 1, ctx);
    const alt = node.alternate;
    if (!alt) return;
    if (alt.type === 'IfStatement') {
      this.add(ctx.unit, 'else if', alt, nesting, this.biome);
      return this.visitBranches(alt, nesting, ctx);
    }
    this.add(ctx.unit, 'else', alt, nesting, false, this.tokenAfter('else', node.consequent.range[1]));
    this.visit(alt, nesting + 1, ctx);
  }

  visitConditional(node, nesting, ctx) {
    this.add(ctx.unit, '?:', node, nesting, true, this.tokenAfter('?', node.test.range[1]));
    this.visit(node.test, this.conditionNesting(nesting), ctx);
    this.visit(node.consequent, nesting + 1, ctx);
    this.visit(node.alternate, nesting + 1, ctx);
  }

  visitSwitch(node, nesting, ctx) {
    this.add(ctx.unit, 'switch', node, nesting, true);
    this.visit(node.discriminant, this.conditionNesting(nesting), ctx);
    for (const switchCase of node.cases) this.visit(switchCase, nesting + 1, ctx);
  }

  // Biome also counts `finally`: +1, like `else`.
  visitTry(node, nesting, ctx) {
    this.visitChildren(node, nesting, ctx);
    if (!this.biome || !node.finalizer) return;
    const before = (node.handler ?? node.block).range[1];
    this.add(ctx.unit, 'finally', node.finalizer, nesting, false, this.tokenAfter('finally', before));
  }

  visitCatch(node, nesting, ctx) {
    this.add(ctx.unit, 'catch', node, nesting, true);
    if (node.param) this.visit(node.param, nesting, ctx);
    this.visit(node.body, nesting + 1, ctx);
  }

  visitLoop(node, nesting, ctx) {
    this.add(ctx.unit, LOOP_LABELS[node.type], node, nesting, true);
    const head = this.conditionNesting(nesting);
    for (const child of childNodes(node)) this.visit(child, child === node.body ? nesting + 1 : head, ctx);
  }

  // Biome scores the condition of an if, loop, switch or ternary one level deeper.
  conditionNesting(nesting) {
    return this.biome ? nesting + 1 : nesting;
  }

  // Only labelled jumps count; plain break/continue are free.
  visitJump(node, nesting, ctx) {
    if (!node.label) return;
    const keyword = node.type === 'BreakStatement' ? 'break' : 'continue';
    this.add(ctx.unit, `${keyword} ${node.label.name}`, node, nesting, false);
  }

  // One increment per run of like operators: `a && b && c` = +1, `a && b || c` = +2.
  // `??` is null-coalescing shorthand and is ignored, as the whitepaper says.
  visitLogical(node, nesting, ctx) {
    if (this.biome) return this.visitLogicalBiome(node, nesting, ctx);
    if (node.operator === '??') return this.visitChildren(node, nesting, ctx);
    const operators = [];
    const operands = [];
    flattenLogical(node, operators, operands);
    operators.forEach((op, i) => {
      if (op.operator === operators[i - 1]?.operator) return;
      this.add(ctx.unit, op.operator, op, nesting, false, this.tokenAfter(op.operator, op.left.range[1]));
    });
    for (const operand of operands) this.visit(operand, nesting, ctx);
  }

  // Biome follows the expression tree: +1 for each operator, `??` included, that
  // doesn't continue its parent's run. Brackets start a new run.
  visitLogicalBiome(node, nesting, ctx) {
    const parent = this.parents.get(node);
    const continuesRun =
      parent.type === 'LogicalExpression' && parent.operator === node.operator && !isParenthesized(this.code, node);
    if (!continuesRun) {
      this.add(ctx.unit, node.operator, node, nesting, false, this.tokenAfter(node.operator, node.left.range[1]));
    }
    this.visitChildren(node, nesting, ctx);
  }

  // Nested functions add no increment but raise the nesting level. Biome scores
  // each one as its own function, still one level deeper.
  visitFunction(fn, nesting, ctx) {
    if (!ctx.promote && !this.biome) {
      this.addRecursion(ctx.unit, fn);
      return this.visitChildren(fn, nesting + 1, { unit: ctx.unit, promote: false });
    }
    const lines = fn.loc.end.line - fn.loc.start.line + 1;
    const unit = this.newUnit(functionName(fn, this.parents, this.code), startOf(fn), lines);
    this.addRecursion(unit, fn);
    const inner = ctx.promote ? nesting : nesting + 1;
    this.visitChildren(fn, inner, { unit, promote: this.isDeclarative(fn) });
  }

  addRecursion(unit, fn) {
    const call = this.recursion.get(fn);
    if (call) unit.increments.push({ ...call, kind: 'recursion', increment: 1, nesting: 0 });
  }

  // Biome has no declarative-wrapper exception: inner functions stay nested.
  isDeclarative(fn) {
    if (this.biome) return false;
    if (!this.declarative.has(fn)) this.declarative.set(fn, isDeclarative(fn));
    return this.declarative.get(fn);
  }
}

function finishUnit(unit) {
  unit.increments.sort((a, b) => a.line - b.line || a.column - b.column);
  const score = unit.increments.reduce((sum, inc) => sum + inc.increment, 0);
  return { ...unit, score };
}

function flattenLogical(node, operators, operands) {
  if (node.type !== 'LogicalExpression' || node.operator === '??') {
    operands.push(node);
    return;
  }
  flattenLogical(node.left, operators, operands);
  operators.push(node);
  flattenLogical(node.right, operators, operands);
}

// The AST drops brackets, so look for them around the node in the source.
function isParenthesized(code, node) {
  let before = node.range[0];
  while (before > 0 && /\s/.test(code[before - 1])) before--;
  let after = node.range[1];
  while (after < code.length && /\s/.test(code[after])) after++;
  return code[before - 1] === '(' && code[after] === ')';
}

// Whitepaper Appendix A, "JavaScript: Missing class structures": an outer
// function that contains only declarations at its top level (a factory or
// module pattern) is ignored, and its nested functions are scored as
// top-level functions. Any structural increment in its own body (outside
// nested functions) makes it a normal function again.
const DECLARATION_STATEMENTS = new Set([
  'VariableDeclaration',
  'FunctionDeclaration',
  'ClassDeclaration',
  'EmptyStatement',
  'TSTypeAliasDeclaration',
  'TSInterfaceDeclaration',
  'TSEnumDeclaration',
  'TSModuleDeclaration',
]);
// What a declarative wrapper may return: `return { find, save }`, `return inner`.
const DECLARATIVE_VALUES = new Set([
  'ObjectExpression',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ClassExpression',
  'Identifier',
]);

// `{ ... } as T`, `satisfies T`, `x!` and `<T>x` are still the value inside.
const TS_WRAPPERS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion']);
const isDeclarativeValue = (node) =>
  TS_WRAPPERS.has(node.type) ? isDeclarativeValue(node.expression) : DECLARATIVE_VALUES.has(node.type);

function isDeclarativeStatement(statement) {
  if (DECLARATION_STATEMENTS.has(statement.type)) return true;
  if (statement.type === 'ReturnStatement') return !statement.argument || isDeclarativeValue(statement.argument);
  if (statement.type !== 'ExpressionStatement') return false;
  return Boolean(statement.directive) || statement.expression.type === 'AssignmentExpression';
}

function isDeclarative(fn) {
  const { body } = fn;
  const onlyDeclarations =
    body.type === 'BlockStatement' ? body.body.every(isDeclarativeStatement) : isDeclarativeValue(body);
  return onlyDeclarations && !containsStructural(fn);
}

// Looks for structural increments, not descending into nested functions.
function containsStructural(node) {
  for (const child of childNodes(node)) {
    if (FUNCTION_TYPES.has(child.type)) continue;
    if (STRUCTURAL_TYPES.has(child.type) || containsStructural(child)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Recursion: +1 for each function in a call cycle, direct or indirect.
// Resolution is by name within one file: plain calls `foo()` and `this.foo()`
// inside a class. Names declared more than once in a file are skipped.
// ---------------------------------------------------------------------------

// Returns Map(function node -> position of its first call into its cycle).
function findRecursion(ast, parents, position) {
  const byName = functionsByName(ast, parents);
  const edges = callEdges(ast, parents, byName, position);
  const result = new Map();
  for (const component of stronglyConnected(edges)) {
    for (const fn of component) {
      const call = firstCallInto(edges.get(fn), component);
      if (call && (component.length > 1 || edges.get(fn).has(fn))) result.set(fn, call);
    }
  }
  return result;
}

function functionsByName(ast, parents) {
  const byName = new Map();
  walk(ast, (node) => {
    const key = functionKey(node, parents);
    if (key) byName.set(key, byName.has(key) ? null : node);
  });
  return byName;
}

// Map(caller -> Map(callee -> position of the first call)).
function callEdges(ast, parents, byName, position) {
  const edges = new Map();
  walk(ast, (node) => {
    if (node.type !== 'CallExpression') return;
    const callee = resolveCallee(node.callee, node, parents, byName);
    const caller = callee && enclosingNamedFunction(node, parents, byName);
    if (!caller) return;
    if (!edges.has(caller)) edges.set(caller, new Map());
    const calls = edges.get(caller);
    if (!calls.has(callee)) calls.set(callee, position(node.range[0]));
  });
  return edges;
}

function firstCallInto(calls, component) {
  for (const [callee, call] of calls ?? []) if (component.includes(callee)) return call;
  return null;
}

function functionKey(node, parents) {
  if (!FUNCTION_TYPES.has(node.type)) return null;
  if (node.type === 'FunctionDeclaration' && node.id) return `fn:${node.id.name}`;
  const parent = parents.get(node);
  if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return `fn:${parent.id.name}`;
  if (node.type === 'FunctionExpression' && node.id) return `fn:${node.id.name}`;
  if (isNamedClassMember(parent)) return `class:${classIndex(parents.get(parent), parents)}:${parent.key.name}`;
  return null;
}

function isNamedClassMember(node) {
  const isMember = node?.type === 'MethodDefinition' || node?.type === 'PropertyDefinition';
  return isMember && !node.computed && node.key.type === 'Identifier';
}

const classIds = new WeakMap();
let nextClassId = 0;
function classIndex(classBody, parents) {
  const cls = parents.get(classBody) ?? classBody;
  if (!classIds.has(cls)) classIds.set(cls, nextClassId++);
  return classIds.get(cls);
}

function resolveCallee(callee, call, parents, byName) {
  if (callee.type === 'ChainExpression') callee = callee.expression;
  if (callee.type === 'Identifier') return byName.get(`fn:${callee.name}`) ?? null;
  if (!isThisMethodCall(callee)) return null;
  const classBody = enclosing(call, parents, (node) => node.type === 'ClassBody');
  if (!classBody) return null;
  return byName.get(`class:${classIndex(classBody, parents)}:${callee.property.name}`) ?? null;
}

function isThisMethodCall(callee) {
  if (callee.type !== 'MemberExpression' || callee.computed) return false;
  return callee.object.type === 'ThisExpression' && callee.property.type === 'Identifier';
}

// Calls inside anonymous callbacks count for the nearest named function around them.
function enclosingNamedFunction(node, parents, byName) {
  return enclosing(node, parents, (current) => {
    const key = functionKey(current, parents);
    return Boolean(key) && byName.get(key) === current;
  });
}

function enclosing(node, parents, predicate) {
  for (let current = parents.get(node); current; current = parents.get(current)) {
    if (predicate(current)) return current;
  }
  return null;
}

// Tarjan's strongly connected components.
function stronglyConnected(edges) {
  const state = { edges, index: new Map(), low: new Map(), stack: [], onStack: new Set(), components: [] };
  for (const v of edges.keys()) {
    if (!state.index.has(v)) connect(v, state);
  }
  return state.components;
}

function connect(v, state) {
  const { index, low, stack, onStack } = state;
  index.set(v, index.size);
  low.set(v, index.get(v));
  stack.push(v);
  onStack.add(v);
  for (const w of state.edges.get(v)?.keys() ?? []) {
    if (!index.has(w)) connect(w, state);
    if (onStack.has(w)) low.set(v, Math.min(low.get(v), low.get(w)));
  }
  if (low.get(v) === index.get(v)) state.components.push(popComponent(v, state));
}

function popComponent(v, { stack, onStack }) {
  const component = [];
  let w;
  do {
    w = stack.pop();
    onStack.delete(w);
    component.push(w);
  } while (w !== v);
  return component;
}

// ---------------------------------------------------------------------------
// Names and positions
// ---------------------------------------------------------------------------

function functionName(fn, parents, code) {
  if (fn.id) return fn.id.name;
  const parent = parents.get(fn);
  const namer = NAMERS[parent?.type];
  return namer ? namer(parent, parents, code) : '<anonymous>';
}

// Parent node type -> name for an anonymous function under it.
const NAMERS = {
  VariableDeclarator: (parent) => (parent.id.type === 'Identifier' ? parent.id.name : '<anonymous>'),
  MethodDefinition: classMemberName,
  PropertyDefinition: classMemberName,
  Property: (parent, _parents, code) => keyName(parent.key, code),
  AssignmentExpression: (parent, _parents, code) => code.slice(...parent.left.range),
  ExportDefaultDeclaration: () => 'default',
  CallExpression: callbackName,
  NewExpression: callbackName,
};

function classMemberName(member, parents, code) {
  const cls = parents.get(parents.get(member));
  return `${cls?.id?.name ?? '<class>'}.${keyName(member.key, code)}`;
}

function callbackName(call, _parents, code) {
  return `<callback ${truncate(code.slice(...call.callee.range))}>`;
}

function keyName(key, code) {
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'PrivateIdentifier') return `#${key.name}`;
  if (key.type === 'Literal') return String(key.value);
  return `[${truncate(code.slice(...key.range))}]`;
}

function truncate(text) {
  const flat = text.replace(/\s+/g, ' ');
  return flat.length > 40 ? `${flat.slice(0, 37)}...` : flat;
}

function startOf(node) {
  return { line: node.loc.start.line, column: node.loc.start.column + 1 };
}

// Offset of the first `token` after `from`; used to point at `?`, `else`, `&&`.
// Only affects reported columns, never scores.
function tokenOffset(code, token, from) {
  const found = code.indexOf(token, from);
  return found === -1 ? from : found;
}

function computeLineStarts(code) {
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') starts.push(i + 1);
  return starts;
}

function offsetToPosition(lineStarts, offset) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - lineStarts[lo] + 1 };
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

const EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'out',
  '.next',
  'cdk.out',
  '.serverless',
  '.aws-sam',
  '.turbo',
  '.cache',
]);

function isSourceFile(path) {
  return EXTENSIONS.has(extname(path)) && !/\.d\.[mc]?ts$/.test(path) && !path.endsWith('.min.js');
}

export function collectFiles(paths) {
  const files = [];
  for (const path of paths) collectFrom(path, files);
  return files;
}

function collectFrom(path, files) {
  if (statSync(path).isFile()) {
    if (isSourceFile(path)) files.push(path);
    return;
  }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const skipped = entry.isDirectory() ? SKIP_DIRS.has(entry.name) : !entry.isFile();
    if (!skipped) collectFrom(join(path, entry.name), files);
  }
}

export function scoreFile(path, { biome = false } = {}) {
  const ext = extname(path);
  // .ts must parse without JSX so `<T>value` type assertions work.
  const jsx = !['.ts', '.mts', '.cts'].includes(ext);
  return scoreSource(readFileSync(path, 'utf8'), { jsx, biome });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: score.mjs [options] <file|dir>...

Scores the Cognitive Complexity of every function in the given TS/JS files
(directories are scanned recursively; node_modules, dist, build, cdk.out, ...
are skipped).

Options:
  --threshold <n>  Mark functions scoring above n; exit 1 if any do
  --explain        Print the per-line breakdown for every function listed
                   (functions above the threshold always get one)
  --json           Print JSON instead of a table (includes score-0 functions)
  --biome          Score like Biome's noExcessiveCognitiveComplexity (see
                   references/scoring-rules.md)
  -h, --help       Show this help

Exit codes: 0 ok, 1 threshold exceeded, 2 usage or parse error.`;

function parseOptions(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      threshold: { type: 'string' },
      explain: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      biome: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const threshold = values.threshold === undefined ? undefined : Number(values.threshold);
  if (threshold !== undefined && !Number.isInteger(threshold)) throw new Error('--threshold needs an integer');
  return { ...values, threshold, paths: positionals };
}

function scoreAll(files, { biome }) {
  const results = [];
  let parseErrors = 0;
  for (const path of files) {
    const file = relative(process.cwd(), path) || path;
    try {
      for (const fn of scoreFile(path, { biome })) results.push({ file, ...fn });
    } catch (error) {
      parseErrors++;
      console.error(`score.mjs: cannot parse ${file}: ${error.message}`);
    }
  }
  return { results, parseErrors };
}

const isOver = (result, threshold) => threshold !== undefined && result.score > threshold;

function formatIncrement(inc) {
  const where = `${inc.line}:${inc.column}`.padEnd(8);
  const nesting = inc.nesting > 0 ? `  (nesting ${inc.nesting})` : '';
  return `    ${where} ${inc.kind.padEnd(16)} +${inc.increment}${nesting}`;
}

// Markdown table cells: a `|` would end the cell.
const cell = (text) => String(text).replaceAll('|', '\\|');

// The three largest increments, e.g. `if +4 (L210)`.
function topContributors(increments) {
  const largest = [...increments].sort((a, b) => b.increment - a.increment || a.line - b.line).slice(0, 3);
  return largest.map((inc) => `${inc.kind} +${inc.increment} (L${inc.line})`).join(', ');
}

function formatRow(result, threshold) {
  const score = isOver(result, threshold) ? `${result.score} ✗` : result.score;
  const cells = [result.file, result.name, result.line, result.lines, score, topContributors(result.increments)];
  return `| ${cells.map(cell).join(' | ')} |`;
}

function formatBreakdown(result) {
  const heading = `${result.file}:${result.line}:${result.column}  ${result.name}  ${result.score}`;
  return ['```', heading, ...result.increments.map(formatIncrement), '```'].join('\n');
}

// A Markdown table, worst first, then the line-by-line breakdown of every
// function above the threshold (or of every row with --explain).
function printTable(results, opts) {
  const rows = results.filter((r) => r.score > 0);
  rows.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line);
  if (rows.length > 0) {
    console.log('| File | Function | Line | Lines | Score | Top contributors |');
    console.log('|---|---|---:|---:|---:|---|');
    for (const row of rows) console.log(formatRow(row, opts.threshold));
  }
  const detailed = rows.filter((r) => opts.explain || isOver(r, opts.threshold));
  for (const row of detailed) console.log(`\n${formatBreakdown(row)}`);
  const overCount = rows.filter((r) => isOver(r, opts.threshold)).length;
  const summary = opts.threshold === undefined ? '' : `, ${overCount} above ${opts.threshold}`;
  console.log(`\n${results.length} functions scored${summary}`);
}

function main(argv) {
  let opts;
  try {
    opts = parseOptions(argv);
  } catch (error) {
    console.error(`score.mjs: ${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (opts.help || opts.paths.length === 0) {
    console.log(USAGE);
    return opts.help ? 0 : 2;
  }
  return run(opts);
}

function run(opts) {
  let files;
  try {
    files = collectFiles(opts.paths);
  } catch (error) {
    console.error(`score.mjs: ${error.message}`);
    return 2;
  }
  const { results, parseErrors } = scoreAll(files, opts);
  if (opts.json) console.log(JSON.stringify(results, null, 2));
  else printTable(results, opts);
  if (results.some((r) => isOver(r, opts.threshold))) return 1;
  return parseErrors > 0 ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
