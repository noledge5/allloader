# Claude integration: tiered models, local key, cached prompts

Cove uses the Claude API for four features — **Intake** (natural-language → structured
download plan), **Triage** (understand messy pages / failed **Resolvers**), title
cleanup/naming, and a conversational control panel.

**Decision — tiered models.** Haiku 4.5 (`claude-haiku-4-5`, $1/$5 per 1M) handles the
cheap, high-frequency deterministic calls: title cleanup/naming and straightforward
Intake parsing. Sonnet 5 (`claude-sonnet-5`, $3/$15) handles reasoning: Triage,
ambiguous Intake, and the chat panel. Opus 4.8 (`claude-opus-4-8`, $5/$25) is a manual
escalation for the gnarliest Triage, not a default.

**Why it's recorded.** The non-obvious part is *which tier where* and *why* — naming and
parsing run on nearly every batch item, so putting them on Haiku instead of Opus is a
~5× cost difference at high volume; reasoning tasks are rarer and benefit from Sonnet.
A future reader will otherwise wonder why the model isn't uniform.

**Consequences.**
- The user's own Anthropic API key lives in a local config/env var on the PC — never in
  the repo or `tasks_state.json`.
- The stable system prompt and tool schemas are prompt-cached so repeated calls bill the
  cached prefix at ~0.1×.
- Intake/naming use structured outputs (strict tool use / `output_config.format`) so the
  plan is machine-parseable, not free text.
- Large AI batch operations are gated behind a confirmation, since every call spends the
  user's credit.
