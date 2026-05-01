# greymatter configuration

Every setting greymatter supports, what it does, and what you lose by changing it. Your config lives at `~/.claude/greymatter/config.json`. Missing keys fall back to these defaults.

## Feature Toggles

| Setting | Default | What it does | What you lose if changed |
|---------|---------|--------------|--------------------------|
| `conversation_recall` | `true` | Ingests Claude Code JSONL transcripts into memory.db; powers `recent.js` and conversation-aware lookups. | Disabling turns off session recall — "what did we do last time" queries return nothing. |
| `behavioral_signals` | `true` | Loads dopamine lessons and oxytocin forces into generated rules files; surfaces signals at pre-write and lazy-orientation time. | Disabling skips all signal generation — `/dopamine` and `/oxytocin` capture still works but nothing is surfaced back to Claude. |
| `doc_layer` | `true` | Extracts documentation relationships (markdown cross-refs, doc-to-code links) into the graph. | Disabling shrinks the graph to code-only; doc-driven lookups (`--find` across markdown, doc aliases) degrade. |

## Directories

| Setting | Default | What it does | What you lose if changed |
|---------|---------|--------------|--------------------------|
| `watch_directories` | `[]` | List of absolute paths the extractor registry scans. Empty = auto-detect from cwd. | Leaving empty is fine for most users; setting narrows scanning to specific roots (faster, less noise). |
| `conversation_directories` | `[]` | List of paths containing Claude Code JSONL transcript files. Empty = auto-detect standard locations. | Override only if your Claude Code install stores transcripts somewhere non-standard. |

## Signals

| Setting | Default | What it does | What you lose if changed |
|---------|---------|--------------|--------------------------|
| `signals.threshold` | `75` | Minimum weight for a signal to be included in generated rules. | Lowering surfaces more signals (noisier rules); raising keeps only high-conviction lessons. |
| `signals.review_cadence_days` | `30` | How often `--review` nags you to consolidate. | Raising defers hygiene; lowering increases maintenance overhead. |
| `signals.staleness_months` | `6` | Signals not reinforced within this window are surfaced as stale during review. | Raising keeps old lessons around longer; lowering prunes more aggressively. |

## Orientation

| Setting | Default | What it does | What you lose if changed |
|---------|---------|--------------|--------------------------|
| `orientation.lazy` | `true` | Project orientation (project-scoped signals) fires on first file touch in a project, not at session start. | Disabling has no alternative mode yet — orientation simply does not run. Leave on. |

## Hypothalamus

Safety policy applied before tool use. Each category accepts: `block` (refuse), `ask` (prompt user), `warn` (inform but proceed), `inform` (silent logging).

| Setting | Default | What it does | What you lose if changed |
|---------|---------|--------------|--------------------------|
| `hypothalamus.database_files` | `ask` | Behavior when Claude tries to edit a `.db`, `.sqlite`, migration, or schema file. | Downgrading to `warn` or `inform` removes the speed-bump that prevents accidental DB corruption. |
| `hypothalamus.secret_files` | `block` | Behavior when Claude tries to touch `.env`, credential files, private keys. | Downgrading is dangerous — secrets can be committed or overwritten silently. |
| `hypothalamus.high_blast_radius` | `warn` | Behavior for files imported by many others (blast radius ≥ threshold). | Disabling silences warnings about edits that ripple through the codebase. |
| `hypothalamus.config_files` | `warn` | Behavior for config and settings files. | Disabling removes the reminder that a config change may affect runtime behavior across environments. |
| `hypothalamus.generated_files` | `inform` | Behavior for files marked generated/committed-but-derived. | Typically safe to leave as `inform`; raising to `warn`/`ask` is annoying since generated files get overwritten anyway. |
| `hypothalamus.documented_files` | `inform` | Behavior for files with doc-layer annotations marking them load-bearing. | Raising gives extra friction around flagged files; lowering ignores the annotations. |
| `hypothalamus.blast_radius_threshold` | `5` | Import count at which a file counts as "high blast radius." | Lowering makes the warning more aggressive; raising makes it rarer. |

## Extraction

| Setting | Default | What it does | What you lose if changed |
|---------|---------|--------------|--------------------------|
| `extraction.max_file_size_kb` | `500` | Files larger than this are skipped during extraction. | Raising includes large generated files (minified bundles, data blobs) that rarely yield useful symbols. |

> **Removed:** `extraction.skip_directories` was retired in favor of the unified exclusion policy (see below). If your `config.json` still has it, port the values to `exclusion.extra_patterns` — the old key is no longer read. Existing user values are preserved on disk by additive migration but have no effect.

## Exclusion

Files and directories excluded from scanning, indexing, and MCP read-time results. Resolved from four sources merged with gitignore-style precedence (built-ins → `.gitignore` → `.greymatterignore` → `extra_patterns`); later sources can negate earlier matches via `!pattern`. See `docs/path-exclusion.md` for the full reference.

| Setting | Default | What it does | What you lose if changed |
|---------|---------|--------------|--------------------------|
| `exclusion.respect_gitignore` | `false` | When `true`, `.gitignore` files in the project tree contribute exclusion patterns. Off by default to preserve behavior on existing installs. | Enabling shrinks the indexed file set to match `git ls-files`. Recommended for most users; future versions may flip this default. |
| `exclusion.respect_greymatterignore` | `true` | When `true`, a `.greymatterignore` file at the project root contributes exclusion patterns (same syntax as `.gitignore`). | Disabling means greymatter-specific exclusions are ignored even if the file exists. |
| `exclusion.extra_patterns` | `[]` | Per-user-machine override patterns layered on top of the file-based sources. Highest precedence — can negate built-in or file-based excludes. | Use for one-off local exclusions you don't want to commit to a repo file. |

## Redaction

Content scrubbing applied at every byte-egress boundary (MCP body responses, LLM-bundle assembly, wiki rendering). Independent of file-level exclusion. See `docs/path-exclusion.md` for the rule library.

| Setting | Default | What it does | What you lose if changed |
|---------|---------|--------------|--------------------------|
| `redaction.enabled` | `true` | Master switch for the redaction layer. When `false`, body content leaves greymatter unscrubbed. | Disabling removes a defense-in-depth layer; secrets in code comments may reach LLMs or MCP clients. |
| `redaction.context_window_lines` | `5` | Proximity (in lines) used by the entropy-near-keyword rule to associate high-entropy strings with secret keywords. | Lowering reduces false positives but may miss tokens declared a few lines from their `SECRET=` declaration. |
| `redaction.extra_patterns` | `[]` | User-supplied regex rules layered on top of the six built-in patterns. Each entry: `{ name, regex, replacement }`. | Use for project-specific secret formats (internal token prefixes, etc.) not covered by the defaults. |

## Maintenance

| Setting | Default | What it does | What you lose if changed |
|---------|---------|--------------|--------------------------|
| `tmp_cleanup_max_age_hours` | `24` | `~/.claude/greymatter/tmp/` entries older than this are deleted at session start. | Raising retains scratch files longer; lowering reclaims space faster. |

## Spec Check

`scripts/spec-check.js` has two behaviors inherited from the author's clod-executor workflow. Both are off by default; enable either independently.

| Setting | Default | What it does | What you lose if changed |
|---------|---------|--------------|--------------------------|
| `spec_check.preamble` | `false` | When `true`, `--chunk-content` and `--dispatch` prepend a "Sonnet assignment" standing-rules block (do not commit, do not restart services, observations-file instructions) before the plan header. | Enabling adds ~30 lines of opinionated workflow rules to every chunk assignment. Leave `false` unless your executor is specifically trained on these instructions. |
| `spec_check.command_log_path` | `null` | When set to a path, `--dispatch` appends one `Read <path> and execute it.` line per chunk to that file (creating parent dirs as needed). | Enabling writes to an external file on every dispatch. Leave `null` unless you have a clipboard/command-log integration watching that path. |

CLI flags override this config per-invocation: `--preamble` / `--no-preamble` override `preamble`, and `--command-log <path>` / `--command-log=` override `command_log_path`.

## Test alerts

Opt-in stale-test-pair detection. When a project is listed in `enabled_projects`, greymatter cross-references recent source-file changes against changes to their paired tests and writes findings to `alert_output_dir/<project>.md`. When the list is empty (default), the feature is completely inert.

**Finding project names.** The strings in `enabled_projects` must match the names greymatter assigned during scan (stored in `graph.db`, not filesystem paths). List them with:

    node scripts/query.js --list-projects

Example — to enable test alerts for this repo, the entry is `"greymatter"`, not `/home/you/code/greymatter`. Unknown names exit non-zero from the CLI.

| Setting | Default | What it does | What you lose if changed |
|---------|---------|--------------|--------------------------|
| `test_alerts.enabled_projects` | `[]` | List of project names (as shown by `query.js --list-projects`) that participate in the scan. Session-start and CLI iterate exactly this list. | Empty = feature disabled; no output files, no stderr alerts. |
| `test_alerts.check_stale_pairs` | `true` | Flag source files whose paired test was not touched in the same commit range. | Disabling removes the primary signal; only `missing_test` findings remain. |
| `test_alerts.check_missing_tests` | `false` | Flag source files that have no paired test at all. Off by default — noisy in thin-coverage codebases. | Enabling adds a "missing tests" section to every output file. |
| `test_alerts.alert_output_dir` | `~/.claude/greymatter/testalerts` | Where the per-project markdown reports are written. `~` expands to `$HOME`. | Custom path lets reports live next to other project artifacts. |

**Extractor participation.** Pairing logic lives in the extractors. The feature ships with paired-file support for `extractors/javascript.js` and `extractors/typescript.js`. Other languages (`python.js`, `svelte.js`, `markdown.js`) do not participate until their extractor exports a `testPairs` block — see the extractor contract in `docs/superpowers/specs/2026-04-17-test-map-alerts-design.md:124-170`. User-authored extractors gain participation the moment they add the block.
