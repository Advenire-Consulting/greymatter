Flag a behavioral moment — positive (nucleus accumbens) or negative (amygdala). Structured discussion, then store as a weighted signal.

## Process

1. **Ask what happened.** Get the user to describe the specific behavioral moment — what did you do, what was the context, what was the outcome?

2. **Surface the lesson.** Ask: "What's the rule or principle that should guide future behavior here?" Help the user distill it to one crisp, actionable sentence.

3. **Determine polarity and type:**
   - Positive (+) reinforcement of a good behavior → `nucleus_accumbens`
   - Negative (-) correction of a bad behavior → `amygdala`
   - Reflection or learning for future recall → `hippocampus`
   - Judgment or reasoning pattern → `prefrontal`

4. **Propose a weight** (50–100). Higher weight = more important, loads earlier into context. Ask the user if it feels right.

5. **Determine trigger.** Default is `passive` (loads at session start). Other options: `pre_write`, `pre_tool_use`, `session_start`. Most behavioral corrections are `passive`.

6. **Write the signal:**
   ```
   node $PLUGIN_ROOT/scripts/signals.js add \
     --type <type> \
     --polarity <+|-> \
     --label "<label>" \
     --weight <N> \
     --trigger passive \
     --description "<description>"
   ```

7. **Regenerate signals.md** (auto-runs after add — no separate step needed).

8. **Confirm** with the user: "Signal saved. Active signals above threshold will load into your next session context."

## Notes

- Keep labels short and actionable — they appear inline in signals.md
- If the user describes multiple related incidents, consider whether they're one signal or several
- If a similar signal already exists (check with `node scripts/signals.js --review`), consider updating its weight instead of adding a duplicate
- `$PLUGIN_ROOT` resolves to the greymatter plugin directory at session start
