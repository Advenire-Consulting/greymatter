---
description: Run greymatter's test-map alert scan for the current project and summarize findings.
---

Run greymatter's test-map alert scan for the current project.

1. Determine the current project name. Prefer the `name` field from the nearest `package.json`; fall back to the basename of the workspace directory if no package.json exists.
2. Run: `node <greymatter-path>/scripts/test-alerts.js --project <name>`
   - `<greymatter-path>` is the greymatter plugin install root. When in doubt, check where `greymatter/scripts/test-alerts.js` lives on disk.
3. Read the output file path from stdout (last token on the project's line, after the arrow `→`).
4. Read the output file and summarize the findings to the user: count of open stale pairs, count of open missing tests, count of newly resolved.
5. Offer to convert any open findings into TodoWrite items if the user wants to work through them.
