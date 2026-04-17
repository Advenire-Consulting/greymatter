# greymatter

Code + conversation knowledge graph for Claude Code. Indexes your codebase and past sessions into a local SQLite store, exposes structured queries Claude can call instead of greping, and keeps behavioral preferences that shape how Claude works with you. All data stays on your machine.

greymatter is the successor to [thebrain](https://github.com/Advenire-Consulting/thebrain) — same goal, rebuilt around a single unified graph instead of separate regional databases. Smaller surface, faster lookups, modular extractor interface for adding new language support.

## What it does

**Code navigation without grep.** Scans your codebase and builds a structured graph of how files connect — imports, exports, routes, database references, function and class definitions. Queries like "what imports this file," "what's the blast radius of changing it," and "show the body of this function" return in one call instead of a grep-then-read chain. Works across every project in your workspace.

**Blast radius that includes textual contracts.** Most code graphs stop at imports. They miss slash commands that shell out to scripts by path, READMEs quoting filenames, rules files pointing at specific modules, and plan docs that cite sources. greymatter pairs its structural blast radius with `grep.js` — a project-aware content search with surrounding context — so before you rename or delete a file, you see every reference to it, code or text. Paired sequences like `--blast-radius` + `grep.js <filename>` are documented in the Combined Recipes section of [`docs/tool-index.md`](docs/tool-index.md#combined-recipes).

**Conversation recall across sessions.** Indexes your Claude Code conversation history — the JSONL files Claude already writes — into a searchable store. "What did we decide about the auth system?" returns the actual back-and-forth. A tiered read ladder (digest → decision → focus → full) lets Claude confirm it has the right session before committing to read the verbatim text.

**Behavioral preferences that persist.** Flag moments that matter with `/dopamine` (lessons from what worked or what burned you) and `/oxytocin` (relational dynamics that shape collaboration). These compile into decision gates that load at session start, so Claude doesn't re-learn your preferences every time.

**Safety hooks on edits and commands.** Before Claude writes a file or runs a shell command, policy hooks classify the target by sensitivity and blast radius and either warn, block, or ask for confirmation. Unparseable commands get flagged for manual review. Configurable per path.

**Project reorientation.** When a session touches a project it hasn't seen in a while, `--reorient <project>` returns the recent session history, decisions made, and files touched — usually under 300 tokens of context you would otherwise re-acquire by reading 10+ files.

**Project-ambiguous recall.** When you reference conversations by count rather than by project — "last session", "a couple sessions ago", "the session before that" — `--recent [N]` returns the N most recent sessions across all projects, ordered by start time, with each session tagged with every project it touched. Cross-project sessions appear once with all projects listed, not once per project.

**Local-only data.** Everything lives in SQLite under `~/.claude/greymatter/`. Nothing syncs externally, nothing leaves your machine.

**Single runtime dependency.** Just `better-sqlite3`. No language servers, no external services, no API keys.

## Prerequisites

- Node.js 18 or newer
- Claude Code CLI

## Installation

greymatter uses `better-sqlite3`, a native module that compiles against your Node version on install.

### Clone (recommended)

```
git clone https://github.com/Advenire-Consulting/greymatter.git
cd greymatter && npm install
claude plugins marketplace add /absolute/path/to/greymatter
claude plugins install greymatter@greymatter
```

### Marketplace (direct from GitHub)

```
claude plugins marketplace add Advenire-Consulting/greymatter
claude plugins install greymatter@greymatter
```

With the direct path, install the native dependency in the plugin cache before first use:

```
cd ~/.claude/plugins/cache/greymatter/greymatter/<version> && npm install
```

Run `ls ~/.claude/plugins/cache/greymatter/greymatter/` to see the installed version.

## First-run behavior

On first session after install, greymatter auto-creates:

- `~/.claude/greymatter/` — data directory (graph.db, memory.db, config.json, tmp/)
- `~/.claude/rules/` — rules directory (shared with other plugins)

It then seeds starter behavioral signals and forces so you have something to react to. You'll see a one-line note:

```
Seeded N starter signals and M forces. Use /dopamine and /oxytocin to customize.
```

## Configuration

Every setting, its default, and what you lose by disabling it lives in [`config/defaults.md`](config/defaults.md). At runtime, config is loaded from `~/.claude/greymatter/config.json` and deep-merged over the defaults — so you only need to override what you want to change.

## Commands

- `/dopamine` — flag a behavioral moment (positive or negative); guided flow adds a weighted lesson.
- `/oxytocin` — flag a relational dynamic; guided flow reinforces an existing force or names a new one.

## Signal hygiene

Run a monthly review to surface stale and overlapping signals:

```
node scripts/signals.js --review
```

## Spec & Plan tooling

`scripts/spec-check.js` cross-checks spec/plan markdown docs for collisions and extracts chunk assignments from implementation plans. See [`docs/tool-index.md`](docs/tool-index.md#specplan-tools) for the full command table.

```
node scripts/spec-check.js --dir <path>                      # Scan for collisions
node scripts/spec-check.js --template spec|plan              # Print frontmatter template
node scripts/spec-check.js --list-chunks <plan>              # List chunks with line ranges
node scripts/spec-check.js --chunk-content <plan> <n>        # Extract one chunk's assignment
node scripts/spec-check.js --dispatch <plan>                 # Write every chunk to <plan-dir>/chunks/
```

By default, `--chunk-content` and `--dispatch` emit just the semantic sections — plan header, prior observations, chunk body — and `--dispatch` writes nothing outside the chunks directory. Two behaviors are available as opt-ins for workflows that need them:

| Setting | Default | What it does |
|---------|---------|-------------|
| `spec_check.preamble` | `false` | When `true`, prepends a workflow-rules block (don't commit, don't restart services, observations-file instructions) to every chunk assignment. |
| `spec_check.command_log_path` | `null` | When set to a path, `--dispatch` appends one `Read <path> and execute it.` line per chunk to that external file. |

Enable in `~/.claude/greymatter/config.json`:

```json
{
  "spec_check": {
    "preamble": true,
    "command_log_path": "/abs/path/to/command-log.txt"
  }
}
```

Per-invocation overrides: `--preamble` / `--no-preamble`, and `--command-log <path>` / `--command-log=` (empty value disables for one call).

## Architecture

greymatter keeps two databases with different guarantees:

- **graph.db** — rebuildable. Derived from your codebase by scanning. Safe to delete; a fresh scan regenerates it.
- **memory.db** — irreplaceable. Conversation windows, decisions, behavioral signals, forces, aliases. Back this up.

The **extractor registry** (`lib/extractor-registry.js`) dispatches file parsing by language. Add a language by authoring an extractor module and registering it — no other edits needed.

**Hook lifecycle:**

- `session-start` — tmp cleanup, conversation JSONL ingest, rules-file regeneration, first-run seeding, per-project reorientation context build (recent sessions and decisions, queryable via `query.js --reorient`).
- `pre-tool-use` — hypothalamus policy (block/warn/ask for risky edits), lazy project orientation, pre-write signal triggers.
- `post-tool-use` — incremental graph updates for edited files.

## Data layout

```
~/.claude/greymatter/
  graph.db
  memory.db
  config.json
  tmp/
~/.claude/rules/
  greymatter-tools.md   (generated)
  greymatter-signals.md (generated)
```

## Authoring extractors

See the extractor interface contract at the top of [`lib/extractor-registry.js`](lib/extractor-registry.js). New extractors are auto-discovered from `lib/extractors/` — register, export, and the registry picks them up.

## License

GPL-3.0-only. See [LICENSE](LICENSE) for the full text.

---

Built by [Advenire Consulting](https://advenire.consulting).

Issues, feedback, or want to talk about what you're building with Claude Code? [Open an issue](https://github.com/Advenire-Consulting/greymatter/issues) or reach out at [advenire.consulting](https://advenire.consulting).
