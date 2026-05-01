# greymatter MCP server — operator docs

The greymatter MCP server exposes the graph database over the Model Context Protocol,
letting MCP clients (Claude Desktop, Claude Code, Cursor, Continue) call structured
tools instead of shelling out to bash.

## Quickstart

```bash
# Enable: sets mcp_server: true in config and regenerates greymatter-tools.md
node scripts/mcp.js enable

# Disable: restores CLI-fallback mode
node scripts/mcp.js disable

# Status: print current flag state, binary path, and rule-file timestamp
node scripts/mcp.js status
```

Changes take effect immediately — the rule file is regenerated on each call.
No server restart is required; the MCP client owns the server lifecycle.

## Supported clients

### Claude Desktop

Add to `~/.claude/desktop/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "greymatter": {
      "command": "node",
      "args": ["/absolute/path/to/greymatter/scripts/mcp-server.js"]
    }
  }
}
```

Replace `/absolute/path/to/greymatter` with the actual path to your install.

### Claude Code

Add `.mcp.json` in your project root (or `~/.claude/mcp.json` globally):

```json
{
  "mcpServers": {
    "greymatter": {
      "command": "node",
      "args": ["/absolute/path/to/greymatter/scripts/mcp-server.js"]
    }
  }
}
```

### Cursor

Add to Cursor's MCP config (Settings → MCP):

```json
{
  "greymatter": {
    "command": "node",
    "args": ["/absolute/path/to/greymatter/scripts/mcp-server.js"]
  }
}
```

### Continue

Add to `.continue/config.json`:

```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "stdio",
          "command": "node",
          "args": ["/absolute/path/to/greymatter/scripts/mcp-server.js"]
        }
      }
    ]
  }
}
```

## Inspector

Use the official MCP Inspector to explore tools and prompts interactively:

```bash
npx @modelcontextprotocol/inspector node scripts/mcp-server.js
```

For non-interactive / CI use, the `--cli` flag lets you call tools directly:

```bash
npx @modelcontextprotocol/inspector --cli node scripts/mcp-server.js --method tools/list
npx @modelcontextprotocol/inspector --cli node scripts/mcp-server.js --method tools/call \
  --tool-name get_status
```

## Available tools

| Tool | Description |
|------|-------------|
| `get_status` | Server health, project list, label coverage |
| `get_project_overview` | Recent sessions + file map for a project |
| `get_node_bundle` | Node body + labels + 1-hop edges in one call |
| `walk_flow` | Path skeleton from a starting node |
| `query_blast_radius` | File-level import/imported-by dependencies |
| `find_identifier` | Locate a symbol across all projects |
| `get_label_coverage` | Labeling density at project/file/neighborhood scope |
| `grep_project` | Project-scoped text search with context |
| `get_node` | Single node lookup by project + file + name |

## Available prompts

| Prompt | Description |
|--------|-------------|
| `/orient_project` | Combined overview + status for fast orientation |
| `/safe_to_delete` | Blast radius + grep check before deleting a file |
| `/understand_flow` | Walk flow then bundle key steps |

## Troubleshooting

**`graph.db not found`**
The server looks for `~/.claude/greymatter/graph.db`. Run `node scripts/scan.js --dir <your-project>` to build it.

**Schema version mismatch**
Your `graph.db` was built with an older version. Re-run `node scripts/scan.js --force --dir <your-project>` to rebuild.

**Stale rule file**
If `greymatter-tools.md` still shows CLI commands after enabling MCP mode, re-run:
```bash
node scripts/mcp.js enable
```

**Server exits immediately**
The server is designed to be spawned by an MCP client over stdio. Running it directly in a TTY prints a usage hint and exits. Use the Inspector (above) to interact with it manually.

**Port conflicts**
The stdio transport has no port. If your client reports connection issues, check that `node` is in your `PATH` and that the path to `mcp-server.js` is absolute, not relative.
