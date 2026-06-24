   AgentTalk is an orchestration platform that lets multiple AI coding agents (Claude, Gemini/Antigravity, Codex) collaborate on a software task as a team, under a structured protocol, with a human
  supervising. Think of it as a referee + message bus that turns several independent CLI agents into a coordinated planner/worker crew.

  The core idea: instead of one agent doing everything, AgentTalk runs a team where agents take roles — two planners debate and reach consensus on a plan, then a worker executes it — and a human gates
  the key decisions (approving the plan, resolving conflicts). The agents don't talk directly; they exchange structured JSON messages that the orchestrator validates, routes, and enforces against a
  phase protocol. That protocol is exactly the consensus flow I described: Ack → FactCollect → Discussion → Proposal → Endorsement → Submittal → UserConfirm → Worker.

  How agents connect (the transport): AgentTalk runs as an MCP server. Provider CLIs are launched externally by the operator and attach over a persistent WebSocket. Each attached agent runs a
  pull-based turn loop — it blocks on an await_turn tool, the orchestrator hands it a turn, and the agent's structured response maps to MCP tool calls (submit_plan, send_to_agent, fact_collection_end,
  etc.). This is what makes the protocol work across isolated, heterogeneous agent processes.

  Key components (the nouns in the diagram):
  - Orchestrator / TeamCoordinator — the referee. Owns the protocol state machine, message routing, phase enforcement, and all the timers.
  - Registry — tracks agents, their lifecycle/state (ready, working, error, terminated), and team membership.
  - Planners / Worker — the agent roles in a team.
  - Web UI — where the human creates tasks, watches the conversation, and confirms/rejects plans.
  
  
  AgentTalk Consensus Protocol — Narrative for Diagramming

  Actors

  - User / UI — creates the task, and at the end confirms or rejects the plan.
  - Orchestrator (the TeamCoordinator) — the referee. It never proposes content; it routes messages, enforces phase rules, and runs all timers.
  - Planner A and Planner B — two peer agents that debate and reach consensus. One is flagged initiator (always the first planner listed); the other is the peer.
  - Worker — a separate agent that executes the agreed plan after the user confirms.

  The happy path (linear spine of the diagram)

  1. Task creation. User creates a team task naming the two planners. Orchestrator sends each planner an ack_planning_protocol briefing.
  2. Acknowledgement phase. Each planner replies ack_planning_protocol. The orchestrator waits until both have acked. (If a planner tries to send an opinion before acking, it's blocked and the ack is
  re-requested.)
  3. Fact collection begins. Once both acked, orchestrator broadcasts fact_collection_begin (carrying the task description + peer IDs) to both planners, and arms the fact-collection timeout.
  4. Investigation (async). Each planner independently investigates the codebase. There's no cross-talk in this phase.
  5. Fact collection ends. Each planner sends fact_collection_end with a summary. Orchestrator waits for both. When both are in, it opens the discussion phase by sending conversation_start (mode:
  planning) to both — the first planner is marked initiator: true.
  6. Discussion phase. Planners exchange opinion messages (peer-to-peer, relayed by the orchestrator). Each planner has a reply cap (maxRepliesPerAgent, default 10). When a planner is one reply away
  from the cap, the orchestrator nudges it to move to a proposal.
  7. Proposal phase. A planner sends agreement_proposal (non-empty proposal text). Orchestrator records the proposer, then targets the other planner and requests agreement_acceptance from it. State
  becomes "proposal pending endorsement."
  8. Endorsement phase. The targeted peer (must NOT be the proposer) sends agreement_acceptance whose proposal text must exactly match the pending proposal. Orchestrator records the agreement and —
  critically — records which planner endorsed, because that planner is now barred from submitting the plan. State becomes "submittal pending"; orchestrator arms the submit-plan urgency timer.
  9. Submittal phase. The other planner (the one who did NOT endorse — normally the original proposer) sends submit_plan with the full plan. Its proposal text must match the accepted proposal, and the
  plan must pass an "implementation-ready" content check. Orchestrator stores the plan, clears all timers, sets task status to awaiting_confirmation, tells both planners conversation_end ("planning
  complete"), and requests their graceful shutdown.
  10. User confirmation.
    - Confirm → task status delegated, team status working; the Worker receives a team_work_assign carrying the plan + description.
    - Reject → task returns to planning, plan cleared, rejection feedback sent back, watchdog re-armed (loops back to the discussion/proposal area).
  11. Worker phase. Worker replies work_accept (→ in_progress) or work_refuse (→ refused/error). On success it later sends submit_work_result (→ completed).

  So the spine is: Ack → FactCollect → Discussion → Proposal → Endorsement → Submittal → UserConfirm → Worker.

  Two key asymmetry rules (worth calling out visually)

  - Initiator vs peer: the first planner leads; the peer waits then responds.
  - Endorser ≠ submitter: the planner who endorses the proposal is forbidden from submitting the plan. The other one submits. This is a deliberate two-person check.

  Branch / error paths (the state-machine edges)

  These are best drawn as labeled transitions off the spine:

  - Protocol ranks: the four planning messages have an ordering rank — opinion=0, agreement_proposal=1, agreement_acceptance=2, submit_plan=3. The orchestrator tracks the max rank reached.
  - Regression (a message with rank lower than the current max): orchestrator asks "did you really mean to go back?" and rejects the message. Up to 2 confirmation attempts (MAX_REGRESSION_RETRIES). If
  the agent confirms/repeats the regression → planning interrupted. If it corrects course → counter clears.
  - Violation (a message that's neither expected nor a valid regression): planning interrupted immediately.
  - Fallback-to-discussion: if the endorsement-target planner sends a regular opinion instead of agreement_acceptance, the orchestrator falls back to the discussion phase (resets expected types, clears
  max rank + agreement state). Allowed up to 2 times (MAX_AGREEMENT_ENDORSEMENT_DISCUSSION_FALLBACKS); exceeding it → interrupted. Late stale agreement_acceptance events from the prior cycle are
  silently absorbed.
  - Duplicate proposal while endorsement is pending: same proposal = absorbed as a harmless race; a different proposal = rejected.
  - Interruption is a terminal error state: all planners notified and asked to shut down.

  Timers (annotations on the relevant states)

  - Fact collection: 480s (12 min → 720s for Gemini teams). Miss → interrupt.
  - Planning watchdog: 900s overall. No submit_plan in time → interrupt.
  - Submit-plan urgency: 120s after endorsement; re-nudged up to 2× (MAX_URGENCY_IGNORES), then interrupt.
  - Agreement compliance: 60s after requesting a proposal/acceptance; re-asked up to 2× (MAX_AGREEMENT_ASKS), then interrupt.
  - Agent shutdown: 60s grace after submit/interrupt, then force-removed.