import type { AgentAdapter } from "./types";

/** Stands in until a real agent is attached. Delete it from the registry then. */
export const placeholderAgent: AgentAdapter = {
  id: "placeholder",
  name: "Agent",
  suggestions: [
    "Who farrows this week?",
    "Who's ready for market?",
    "Log a weigh-in",
    "Summarize this week",
  ],
  send: () => "I'm not connected yet. This chat is a preview, so I can't look anything up for now.",
};
