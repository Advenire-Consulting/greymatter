# greymatter

Unified code + documentation knowledge graph for Claude Code. Bundles code navigation, conversation recall, behavioral signals (dopamine/oxytocin flows), and safety hooks in one plugin. Data is stored locally in SQLite; nothing leaves your machine.

## Prerequisites

- Node.js 18 or newer
- better-sqlite3 (installed automatically as a plugin dependency)

## Installation

```
/plugin install greymatter
```

Local marketplace for now; a public marketplace entry will land when the plugin stabilizes.

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

## Architecture

greymatter keeps two databases with different guarantees:

- **graph.db** — rebuildable. Derived from your codebase by scanning. Safe to delete; a fresh scan regenerates it.
- **memory.db** — irreplaceable. Conversation windows, decisions, behavioral signals, forces, aliases. Back this up.

The **extractor registry** (`lib/extractor-registry.js`) dispatches file parsing by language. Add a language by authoring an extractor module and registering it — no other edits needed.

**Hook lifecycle:**

- `session-start` — tmp cleanup, conversation JSONL ingest, rules-file regeneration, first-run seeding.
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
  signals.md            (generated)
```

## Authoring extractors

See the extractor interface contract at the top of [`lib/extractor-registry.js`](lib/extractor-registry.js). New extractors are auto-discovered from `lib/extractors/` — register, export, and the registry picks them up.
