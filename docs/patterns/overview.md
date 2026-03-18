# Multi-Agent Patterns

These patterns come directly from Anthropic's [Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) playbook and are the same ones implemented in [Laravel's AI SDK](https://laravel.com/blog/building-multi-agent-workflows-with-the-laravel-ai-sdk).

## When to use agents at all

> The key question is not "can I use an agent here?" but "does this task *need* an agent?"

Start with the simplest approach:

1. **Single LLM call** — one `agent().prompt()` with a good system prompt
2. **Prompt chaining** — break into sequential steps, validate in between
3. **Routing** — classify input, dispatch to specialist
4. **Full agent loop** — let the model decide what tools to call and when

Only add complexity when simpler approaches don't meet the quality bar.

## Pattern comparison

| Pattern | Structure | Use when |
|---------|-----------|----------|
| [Prompt Chaining](./prompt-chaining) | A → B → C | Fixed sequence of steps, each building on the last |
| [Routing](./routing) | Input → Classifier → Specialist | Inputs vary by type or required expertise |
| [Parallelization](./parallelization) | A + B + C → Merge | Independent sub-tasks that can run simultaneously |
| [Orchestrator-Workers](./orchestrator-workers) | Planner → Tools → Workers | Dynamic planning; the model chooses what to do next |
| [Evaluator-Optimizer](./evaluator-optimizer) | Generate → Evaluate → Improve | Quality bar requires iterative refinement |

## Combining patterns

These patterns compose naturally. A common production architecture:

```
Routing                    (classify by intent)
  └─► Prompt Chaining      (fixed workflow for that intent)
        ├─► Parallelization (run independent reviewers)
        └─► Evaluator       (polish the final output)
```

## Key principles

**1. Prefer deterministic gates over agent decisions.**
If you can check a condition in code (e.g., "does the score exceed 8?"), do it in code — not by asking the model.

**2. Keep context windows lean.**
Each iteration of the agentic loop costs tokens. Summarise or discard stale history when it is no longer needed.

**3. Instrument everything.**
Collect `response.usage` to track costs per workflow. Log `response.messages` to debug unexpected loops.

**4. Cap iterations.**
Always set `maxIterations` to prevent runaway loops. The default is 10.

---

- [Prompt Chaining →](./prompt-chaining)
- [Routing →](./routing)
- [Parallelization →](./parallelization)
- [Orchestrator-Workers →](./orchestrator-workers)
- [Evaluator-Optimizer →](./evaluator-optimizer)
