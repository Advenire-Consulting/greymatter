---
description: Run greymatter's test-map alert scan for the current project and summarize findings.
---

Run greymatter's test-map alert scan for the current project.

1. **Resolve project name from the graph.db.** Project names in greymatter are assigned at scan time, not derived from `package.json` or the folder basename. Run `node <greymatter-path>/scripts/query.js --list-projects` and pick the entry whose recorded root matches the current workspace (or that the user is clearly working on). If no match exists, the project has never been scanned — tell the user to run `node <greymatter-path>/scripts/scan.js --dir <workspace> --project <name>` first and stop.
   - `<greymatter-path>` is the greymatter plugin install root. Check where `greymatter/scripts/test-alerts.js` lives on disk if unsure.
2. Run: `node <greymatter-path>/scripts/test-alerts.js --project <name>`
3. **If stderr contains `is not in enabled_projects`:** the project is registered in the graph but not opted in for test-map scans. Do NOT edit config silently.
   - Read `~/.claude/greymatter/config.json` and surface the current `test_alerts.enabled_projects` array.
   - Ask the user whether to append this project. On approval, add the name to the array (preserve JSON formatting) and re-run the command from step 2.
   - Reference for the user: `~/.claude/greymatter/config.json` → `test_alerts.enabled_projects`. Full table of knobs is in `<greymatter-path>/config/defaults.md`.
4. **If stderr warns `no stored root_path for <project>; falling back to CWD-join`:** the project was scanned before root tracking landed. Tell the user to rescan with `scripts/scan.js --dir <path> --project <name>` to register the root, then continue with the current run's results.
5. Read the output file path from stdout (last token on the project's line, after the arrow `→`).
6. Read the output file and summarize the findings to the user: count of open stale pairs, count of open missing tests, count of newly resolved.
7. Offer to convert any open findings into TodoWrite items if the user wants to work through them.
