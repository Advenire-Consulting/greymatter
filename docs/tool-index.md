# greymatter — Code + Documentation Knowledge Graph

Spatial awareness and long-term memory for code navigation and project history.
All commands run from your workspace directory.

**Default routing:** When you need to understand code — what files exist, what they do,
what depends on what, what the schema looks like — route through these tools before
falling back to Grep/Glob/Read. They return structured, token-efficient results built
from indexed data.

<!-- region:core -->
## Graph Navigation (~150 tokens)

    node $PLUGIN_ROOT/scripts/query.js <command>

| Command | What it does |
|---------|-------------|
| `--map <project> [path]` | **Check first** — project directory map showing what each file does |
| `--find <identifier>` | Code identifiers across all projects with line numbers |
| `--structure <file> --project <p>` | Function/class/interface/type definitions with line numbers |
| `--body <file> <name> --project <p>` | Extract a named function/definition body — saves a Read call |
| `--blast-radius <file> --project <p>` | What imports it, what it imports |
| `--flow <file> --project <p>` | Everything flowing in/out of a file |
| `--trace <identifier> [--project <p>]` | Follow a value — where set, who reads it, what it calls |
| `--schema [--project <p>]` | Database table structures |
| `--lookup <file> --project <p>` | Exports, routes, db refs, sensitivity |
| `--list-projects` | Browse all known projects |

**Token-saving rule:** When the user asks you to work on a project you haven't touched
this session, run `--map <project>` first. Only read individual files after the map
tells you which ones matter.

## Scan

    node $PLUGIN_ROOT/scripts/scan.js [options]

| Option | What it does |
|--------|-------------|
| `--dir <path>` | Scan a specific directory |
| `--project <name>` | Name to assign to the project |
| `--force` | Re-scan even if file hash is unchanged |

Full project scan — builds graph.db from source files. Run once after install,
then the post-tool-use hook keeps graph.db current on every edit.

<!-- endregion -->

<!-- region:search -->
## Content Search (~variable tokens)

Project-aware search returning matches with surrounding context in one call.
Use these instead of Grep+Read cycles.

### Grep

    node $PLUGIN_ROOT/scripts/grep.js <pattern> [options]

| Option | What it does |
|--------|-------------|
| `--context N` / `-C N` | Lines of context around each match (default: 3) |
| `--project <name>` | Filter to one project (substring match) |
| `--max-per-file N` | Cap matches shown per file (default: 20) |

### Classify

    node $PLUGIN_ROOT/scripts/classify.js --inline "label1=pattern1" "label2=pattern2" [options]
    node $PLUGIN_ROOT/scripts/classify.js <config.json> [options]

| Option | What it does |
|--------|-------------|
| `--project <name>` | Filter to one project |
| `--context N` / `-C N` | Lines of context per match (default: 1) |
| `--no-snippets` | Summary only, no code snippets |

Pattern variant audit with direction detection — categorizes every match by variant.
Use for migration audits, convention checks, routing analysis.

<!-- endregion -->

<!-- region:recall -->
## Conversation Recall (~150 tokens search, ~6K read)

Verbatim conversation recall — reasoning, rejected alternatives, the actual back-and-forth.

### Search

    node $PLUGIN_ROOT/scripts/search.js "term1,term2" "term3" [--limit N]

Terms within quotes are comma-separated OR. Separate arguments are additive clusters.

### Read Window

    node $PLUGIN_ROOT/scripts/read-window.js <session> <seq> [--digest|--decision N|--focus L-L]

| Flag | What it does |
|------|-------------|
| `--digest` | Database-only summary (~200 tokens) |
| `--decision N` | Scoped read of decision N (~500-1K tokens) |
| `--focus <start>-<end>` | Compact read of a line range (~6K tokens) |
| `--full` | Full verbatim text (variable) |

<!-- endregion -->

<!-- region:signals -->
## Behavioral Signals

    node $PLUGIN_ROOT/scripts/signals.js --review

Review all active signals grouped by type, sorted by weight. Shows count, estimated
token cost, and flags overlapping or contradictory signals.

Signals are written via `/dopamine` and `/oxytocin` commands. The `signals.md` rules
file at `~/.claude/rules/signals.md` is regenerated automatically after
each write.

<!-- endregion -->

## Spec/Plan Tools

    node $PLUGIN_ROOT/scripts/spec-check.js <command>

| Flag | What it does |
|------|-------------|
| `--dir <path>` | Scan a folder recursively for specs/plans |
| `--template spec\|plan` | Print a ready-to-fill frontmatter template |
| `--list-chunks <plan>` | List chunks in a plan with line ranges |
| `--chunk-content <plan> <n>` | Full Sonnet assignment for one chunk |
| `--dispatch <plan>` | Write all chunk assignments to `chunks/` directory |

## What Answers What

| Question | Tool |
|----------|------|
| "What's in this project?" / "What does each file do?" | `--map <project>` |
| "What calls this function?" | `--find <identifier>` |
| "What does this file export?" | `--lookup <file>` |
| "What depends on this?" | `--blast-radius <file>` |
| "What's the DB schema?" | `--schema` |
| "What functions are in this file?" | `--structure <file>` |
| "Show me this function's code" | `--body <file> <name>` |
| "How does data flow through this file?" | `--flow <file>` |
| "Where is a value set and who reads it?" | `--trace <identifier>` |
| "Where is this string/pattern used?" | `grep.js <pattern>` |
| "How much code uses pattern A vs B?" | `classify.js --inline "A=..." "B=..."` |
| "What did we decide about X?" | `search.js` + `read-window.js` |

## When Standard Tools Are Shorter

- **"Does this path exist?" / "What's in this directory?"** → `ls`
- **User gave a file path** → `Read` it directly
- **Searching for a known string in 1-2 specific files** → `Grep`
