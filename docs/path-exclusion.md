# Path Exclusion and Redaction Policy

greymatter enforces a single exclusion policy at two boundaries — when files are written into `graph.db` (scan-write) and when nodes are returned to a caller (tool-read). A separate content-redaction layer scrubs sensitive substrings from any text leaving the process. This document covers both.

## Overview

**Two enforcement layers, one source of truth.**

1. **Scan-write.** `lib/file-walker.js` and `scripts/scan.js` consult `isExcluded(absPath, policy)` before any node is written. Excluded paths never enter `graph.db`.
2. **Tool-read.** Every MCP read primitive (`get_node`, `get_node_bundle`, `walk_flow`, `find_identifier`, `grep_project`, `query_blast_radius`, `get_label_coverage`) and CLI script (`query.js`, `grep.js`) filters its result set against the same predicate before returning. A stale node lingering from a prior scan, or a race between an exclusion-config change and the next reconcile, cannot leak through the read layer.

Reconcile compares the resolved exclusion-policy hash against the previous hash on `project_scan_state`. On change, every node, edge, and label rooted at a now-excluded file is purged in a single transaction before the rest of reconcile runs.

## Policy sources

Patterns are merged from four sources, in priority order. Later sources can **negate** matches from earlier sources using `.gitignore`'s `!pattern` syntax — full gitignore precedence semantics, not a simple union.

| # | Source | When read | Default |
|---|--------|-----------|---------|
| 1 | Built-in defaults | Always | On |
| 2 | `.gitignore` chain | When `exclusion.respect_gitignore: true` | Off |
| 3 | `.greymatterignore` | When `exclusion.respect_greymatterignore: true` | On |
| 4 | `exclusion.extra_patterns` from config | Always | `[]` |

**Built-in defaults:** `node_modules/`, `.git/`, `.next/`, `dist/`, `build/`, `.cache/`, `coverage/`, `.nyc_output/`, `__pycache__/`, `.venv/`, `vendor/`, plus the secret-file patterns `*.env`, `*.key`, `*.pem`, `*.p12`, `*.pfx`, `id_rsa*`, `*.crt`, `*.csr`.

### Cross-source negation

Built-ins exclude `*.env`. A user's `.greymatterignore` containing `!templates/example.env` re-includes that one file, because rules added later override earlier matches.

```
# .greymatterignore
!templates/example.env
```

### Gitignore footgun: directory matches short-circuit file negation

This is real-`.gitignore` behavior, not a greymatter quirk. If `.gitignore` excludes a directory with `secrets/`, a later `!secrets/keepme.txt` will **not** re-include the file — the parent-dir match wins. To re-include a file under an excluded directory, you must also re-include the directory:

```
# .gitignore
secrets/
```

```
# .greymatterignore — both lines required
!secrets/
!secrets/keepme.txt
```

File-level patterns negate cleanly: `*.env` + `!templates/example.env` works as expected.

## Opting into `.gitignore` respect

Off by default to preserve current behavior on existing installs. Migration recommendation: turn it on.

```json
// ~/.claude/greymatter/config.json
{
  "exclusion": {
    "respect_gitignore": true
  }
}
```

After flipping the flag, run a reconcile (or trigger one by editing any tracked file) so the policy-hash mismatch fires `purgeExcluded` against any nodes now considered excluded.

## `.greymatterignore` syntax

Same syntax as `.gitignore`. Use it for greymatter-specific exclusions — e.g., docs you keep tracked in git but don't want indexed or labeled.

```
# .greymatterignore
docs/internal-runbook/
*.generated.json
!templates/example.env
```

To disable this source entirely, set `exclusion.respect_greymatterignore: false`.

## Project config patterns

`exclusion.extra_patterns` is the highest-priority source — useful for per-user-machine overrides that you don't want in the repo. Same pattern syntax as `.gitignore`.

```json
// ~/.claude/greymatter/config.json
{
  "exclusion": {
    "respect_gitignore": true,
    "respect_greymatterignore": true,
    "extra_patterns": [
      "scratch/",
      "!scratch/keep.md"
    ]
  }
}
```

## Redaction rule library

Independent of file-level exclusion: even on included files, `redactContent()` scrubs sensitive substrings before any byte leaves the process. It runs at every egress boundary — MCP read primitives that return body content (`get_node`, `get_node_bundle`), the future LLM-bundle assembly path (Spec 2), and the future wiki render path (Spec 4 / 6).

Default rules:

| Rule | Matches | Example |
|------|---------|---------|
| `aws_access_key` | `AKIA[0-9A-Z]{16}` | `AKIAIOSFODNN7EXAMPLE` → `[REDACTED:aws_access_key]` |
| `aws_secret_key` | 40-char base64-ish near the keyword `aws_secret` | secret near `aws_secret = "..."` |
| `github_token` | `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` prefixes | `ghp_abc123...` → `[REDACTED:github_token]` |
| `jwt` | three base64 segments separated by dots, ≥40 chars total | bearer JWT tokens |
| `entropy_near_keyword` | ≥40 chars, Shannon entropy ≥4.5 bits/char, within 5 lines of `SECRET`, `KEY`, `PASSWORD`, `TOKEN`, `CREDENTIAL`, `PRIVATE_KEY`, `API_KEY` | typical `API_KEY = "..."` constants |
| `private_key_block` | `-----BEGIN ... PRIVATE KEY-----` blocks (multi-line) | RSA / EC / OpenSSH private keys |

Each match is replaced with `[REDACTED:<rule_name>]`. The function returns `{ text, redactions: [{ kind, line, original_length }] }` so callers can log redaction counts without storing the originals.

**Fail-closed on oversize.** Content over 5 MB returns `{ text: null, redactions: [], skipped: true, reason: 'oversize' }`. Callers must not emit the original — the MCP read primitives substitute `body: null` with `body_redacted: true` and `body_skip_reason: 'oversize'`. Chunked redaction for large files is deferred to a later spec.

### Adding custom redaction rules

```json
// ~/.claude/greymatter/config.json
{
  "redaction": {
    "enabled": true,
    "context_window_lines": 5,
    "extra_patterns": [
      { "name": "internal_token", "regex": "INTRN_[A-Z0-9]{32}", "replacement": "[REDACTED:internal_token]" }
    ]
  }
}
```

The `regex` field is a string passed to `new RegExp`. Provide a `replacement` to override the `[REDACTED:<name>]` default.

### Known false positive

The `entropy_near_keyword` rule does case-insensitive substring matching on its keyword set (no word boundaries — by design, so `SECRET_KEY` matches the `SECRET` token). Identifiers like `TOKENIZER` near a high-entropy literal will fire the rule. Acceptable false-positive tradeoff for a defense-in-depth scrubber; tune via `redaction.context_window_lines` if your codebase has unusual locality patterns.

## Coverage notes

- `get_label_coverage` filters its file-scoped mode (`file` arg present + excluded → returns `{ excluded: true, ... }`). The project-wide aggregate counts (`total_nodes`, `labeled_count`, etc.) are computed in SQL and do not subtract excluded-file nodes today; the count is approximate when the project has excluded files with stale rows. Run reconcile to purge stale rows and tighten the count.
- `walk_flow` filters intermediate steps whose `step.file` is excluded. The BFS does not descend through excluded steps, so deeper steps reachable only through an excluded intermediate are dropped.
- Metadata-only primitives (`find_identifier`, `query_blast_radius`, `get_label_coverage`) skip redaction — no body fields cross the boundary.
- `purgeExcluded` returns `observations_purged: 0` today as a forward-compat placeholder. The `node_observations` table is not yet shipped; the field stays in the return shape so the contract is stable when the table arrives.

## Diagnostics

Inspect the resolved policy for a project:

```
node scripts/query.js --exclusions <project>
```

Output includes the resolved values of `respect_gitignore` and `respect_greymatterignore`, the policy hash, every pattern with its source (`builtin` / `gitignore` / `greymatterignore` / `config`), and a sample of paths in the project that this policy currently excludes.

Use this to confirm a `.gitignore` or `.greymatterignore` change took effect — the hash should change, and the new patterns should appear under the expected source.

## Migration from `extraction.skip_directories`

The old `extraction.skip_directories` config knob has been **removed** in favor of `exclusion.extra_patterns`. The key is no longer read; if your existing `config.json` still has it, additive migration preserves your value on disk but it has no effect on scanning.

Port your values:

```json
// before
{
  "extraction": {
    "skip_directories": ["fixtures", "generated"]
  }
}

// after
{
  "exclusion": {
    "extra_patterns": ["fixtures/", "generated/"]
  }
}
```

Trailing slashes are recommended for directory patterns (gitignore convention) so they only match directories, not files of the same name.
