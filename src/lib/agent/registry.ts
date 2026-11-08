import type { AgentAdapter } from "./types";
import { placeholderAgent } from "./placeholder";

/**
 * Every agent the panel can talk to. The first is the default. With one agent
 * the panel looks as it always does; with two or more the header gains a
 * switcher, and each agent keeps its own conversation.
 *
 * This module is imported by a client component, so adapters here must be
 * client-safe. Call the server with fetch or a server action; never import
 * `@/server/*` directly.
 */
export const AGENTS: AgentAdapter[] = [placeholderAgent];
