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
| `extraction.skip_directories` | `["node_modules", ".git", "dist", "build", ".next", ".svelte-kit"]` | Directory names the scanner skips wholesale. | Removing entries includes vendored/generated code in the graph (slower scans, noisier results). |
| `extraction.max_file_size_kb` | `500` | Files larger than this are skipped during extraction. | Raising includes large generated files (minified bundles, data blobs) that rarely yield useful symbols. |

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
