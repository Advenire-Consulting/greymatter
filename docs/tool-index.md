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
| `--reorient [project]` | **Check first (alongside `--map`)** — recent sessions, decision terms, and files touched per project. No arg: list all projects with session context. |
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
this session, run `--reorient <project>` for recent activity (sessions, decisions, files
touched) and `--map <project>` for current structure. Only read individual files after
those two orientation moves tell you which ones matter.

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

### Read Window — granularity ladder

    node $PLUGIN_ROOT/scripts/read-window.js <session> <seq> [--digest|--decision N|--focus L-L|--full]

Escalate only when the tier below is insufficient. Each step pays more tokens
for more fidelity — start cheap, stop as soon as you have what you need.

1. `--digest` (~200 tokens) — DB-only summary: decision list + file refs. Use
   to confirm you have the right session before reading any verbatim text.
2. `--decision N` (~500-1K tokens) — one specific decision with surrounding
   reasoning. Use when the digest points at a clear target.
3. `--focus <start>-<end>` (~6K tokens) — compact verbatim of a line range.
   Use when the decision view is too narrow or you need the back-and-forth.
4. `--full` (variable, can be large) — raw verbatim. Last resort; only when
   focused reads keep missing the piece you need.

<!-- endregion -->

<!-- region:signals -->
## Behavioral Signals

    node $PLUGIN_ROOT/scripts/signals.js --review

Review all active signals grouped by type, sorted by weight. Shows count, estimated
token cost, and flags overlapping or contradictory signals.

Signals are written via `/dopamine` and `/oxytocin` commands. The `greymatter-signals.md` rules
file at `~/.claude/rules/greymatter-signals.md` is regenerated automatically after
each write.

<!-- endregion -->

## Spec/Plan Tools

    node $PLUGIN_ROOT/scripts/spec-check.js <command>

| Flag | What it does |
|------|-------------|
| `--dir <path>` | Scan a folder recursively for specs/plans |
| `--template spec\|plan` | Print a ready-to-fill frontmatter template |
| `--list-chunks <plan>` | List chunks in a plan with line ranges |
| `--chunk-content <plan> <n>` | Extract a chunk assignment (plan header + prior observations + chunk body) |
| `--dispatch <plan>` | Write every chunk's assignment to `<plan-dir>/chunks/` |

By default, `--chunk-content` and `--dispatch` emit just the semantic sections — plan header, prior observations, chunk body — and `--dispatch` writes nothing outside the chunks directory. Two opt-ins exist for workflows that need more:

- **Standing-rules preamble** — a workflow-rules block prepended to every chunk (don't commit, don't restart services, observations-file instructions). Enable via `spec_check.preamble: true` in `~/.claude/greymatter/config.json`, or pass `--preamble` on a single invocation. Pass `--no-preamble` to force it off when config has it on.
- **External command-log append** — `--dispatch` can append one `Read <path> and execute it.` line per chunk to an external file (clipboard-window integration, etc.). Enable via `spec_check.command_log_path: "/abs/path"` in config, or pass `--command-log <path>`. Pass `--command-log=` (empty value) to disable for one call.

## What Answers What

| Question | Tool |
|----------|------|
| "What was recently done in this project?" / "Where did we leave off?" | `--reorient <project>` |
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

## Combined Recipes

The single-tool table above answers narrow questions. Real investigations
combine tools. The code graph tracks imports; it does NOT track textual
contracts — slash commands shelling out by flag name, README examples,
spec references, plan docs. Those are caught by `grep.js`. Treat them as
first-class dependents.

| Scenario | Sequence |
|----------|----------|
| "Can I safely wipe or rename this file?" | `--blast-radius <file>` (code consumers) THEN `grep.js <filename>` (textual contracts in commands/, README, plans). Missing the second step misses silent tripwires. |
| "Where is this method actually called?" | `grep.js <methodName>` — `--trace` is thin on method call-sites; it shows definitions and file-level edges, not every call expression. Use `--trace` to locate the definition, `grep.js` to enumerate call sites. |
| "Recover a past decision" | Ladder: `search.js` → `--digest` (~200 tok) → `--decision N` (~500-1K) → `--focus L-L` (~6K) → `--full`. Escalate only when the tier below is insufficient. |
| "Audit a migration's progress" | `classify.js --inline "old=regex1" "new=regex2"` — percentage split plus direction tags ([client]/[server]/[config]/[reference]). |
| "Orient in a project you haven't touched this session" | `--reorient <project>` (recent sessions + decisions) + `--map <project>` (current structure). The pair gives both the *why* of recent work and the *what* of current state in ~300 tokens. Read individual files only after those two. |
| "Understand the full blast radius of a load-bearing script" | `--blast-radius` + `--flow` + `grep.js <filename>` together. The code graph shows wiring; grep reveals the markdown/command/README contracts the graph doesn't track. |

## When Standard Tools Are Shorter

- **"Does this path exist?" / "What's in this directory?"** → `ls`
- **User gave a file path** → `Read` it directly
- **Searching for a known string in 1-2 specific files** → `Grep`
