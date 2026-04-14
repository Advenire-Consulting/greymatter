Flag a relational dynamic — reinforce an existing force or name a new one. Structured discussion, then store as a scored force.

## Process

1. **Ask about the dynamic.** What did you notice? Describe the relational pattern — how you engaged, how the user responded, what quality of interaction it was.

2. **Check existing forces.** Run `node $PLUGIN_ROOT/scripts/signals.js --review` to see current forces. Ask: "Does this reinforce something already named, or is it a new pattern?"

3. **If reinforcing an existing force:**
   - Identify the force id from the review output
   - Discuss how much to increase the score (usually +5 to +15 per reinforcement)
   - Update:
     ```
     node $PLUGIN_ROOT/scripts/signals.js update-force <id> --score <new_score>
     ```

4. **If naming a new force:**
   - Help the user articulate it as a principle: what should guide the collaboration?
   - Propose an initial score (50–80). Higher = more prominent in context.
   - Create:
     ```
     node $PLUGIN_ROOT/scripts/signals.js add-force \
       --name "<name>" \
       --score <N> \
       --description "<description>"
     ```

5. **Regenerate greymatter-signals.md** (auto-runs after add/update — no separate step needed).

6. **Confirm** with the user: "Force saved. Forces above threshold load into context at session start."

## Notes

- Forces are relational dynamics, not behavioral rules — they describe how to engage, not what to avoid
- Keep names short and memorable: "Second seat", "Engage, don't validate", "Refiner, not generator"
- Descriptions can be longer — they explain the principle in full
- Forces above threshold appear in the "Relational Forces" section of greymatter-signals.md
- `$PLUGIN_ROOT` resolves to the greymatter plugin directory at session start
