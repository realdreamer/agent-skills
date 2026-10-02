# Linter and hook integration

Use these to enforce the limit continuously: in the editor, in CI, or after every agent edit. Linter scores can be lower than `score.mjs` (see the comparison in `scoring-rules.md`), so a linter may pass a function the scorer flags.

## ESLint: eslint-plugin-sonarjs

```bash
npm i -D eslint-plugin-sonarjs
```

```js
// eslint.config.js (flat config)
import sonarjs from 'eslint-plugin-sonarjs';

export default [
  {
    plugins: { sonarjs },
    rules: { 'sonarjs/cognitive-complexity': ['error', 15] },
  },
];
```

The rule is also in `sonarjs.configs.recommended`, with a default of 15. Licensing: the npm metadata for v4.2.2 says `LGPL-3.0-only`, but its source files carry the Sonar Source-Available License header. Check that this suits your project.

## Biome

The rule exists but is off by default. Biome scores `??`, `finally` and some nesting higher than the whitepaper, so in a Biome project run the scorer with `--biome` (see `scoring-rules.md`).

```json
{
  "linter": {
    "rules": {
      "complexity": {
        "noExcessiveCognitiveComplexity": {
          "level": "on",
          "options": { "maxAllowedComplexity": 15 }
        }
      }
    }
  }
}
```

## Oxlint

Oxlint's built-in `complexity` rule is cyclomatic, not cognitive. For cognitive complexity use the community JS plugin [`oxlint-plugin-complexity`](https://github.com/itaymendel/oxlint-plugin-complexity) (MIT); its README has the config.

## CI without a linter

The scorer exits 1 when any function is above the threshold:

```bash
node path/to/cognitive-complexity/scripts/score.mjs --threshold 15 src
```

## Claude Code: score after every edit

A `PostToolUse` hook that exits 2 shows its stderr to Claude after the edit, so an over-limit function gets fixed in the same turn. Save this as `.claude/hooks/cognitive-complexity.sh`, make it executable, and set `SCORER` to where this skill lives:

```sh
#!/bin/sh
# PostToolUse hook: score the edited file, report functions above the limit to Claude.
SCORER="$HOME/.claude/skills/cognitive-complexity/scripts/score.mjs"
file=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).tool_input?.file_path??""))')
case "$file" in
  *.d.ts) exit 0 ;;
  *.ts|*.tsx|*.mts|*.cts|*.js|*.jsx|*.mjs|*.cjs) ;;
  *) exit 0 ;;
esac
node "$SCORER" --threshold 15 "$file" >&2 || exit 2
```

Register it in `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "\"${CLAUDE_PROJECT_DIR}\"/.claude/hooks/cognitive-complexity.sh" }
        ]
      }
    ]
  }
}
```

If the project already uses one of the lint rules above, the hook can run that instead, for example `npx eslint --rule '{"sonarjs/cognitive-complexity": ["error", 15]}' "$file" >&2 || exit 2`.
