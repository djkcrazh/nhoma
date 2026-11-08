/**
 * The contract between the Agent panel (UI) and whatever agent sits behind it.
 * The panel never knows how an agent works: it hands over the conversation and
 * the page context, and renders whatever comes back.
 *
 * To attach an agent, implement AgentAdapter and add it to AGENTS in
 * ./registry.ts. See ./README.md.
 */

export type AgentRole = "user" | "agent";

/** One turn as the adapter sees it: no UI state. */
export interface AgentTurn {
  role: AgentRole;
  text: string;
}

/** A message as the panel stores and renders it. */
export interface AgentMessage extends AgentTurn {
  id: number;
  /** Waiting for the first chunk of a reply. */
  pending?: boolean;
  /** The adapter threw; `text` holds the user-facing error. */
  error?: boolean;
}

/** What the UI knows about who is asking and where. Extend as agents need more. */
export interface AgentContext {
  userName: string;
  farmName: string;
  /** "ADMIN" | "FARM_USER" */
  role: string;
  /** The page the user is on, e.g. "/pigs/PIG-003". Lets an agent answer "this pig". */
  pathname: string;
}

/**
 * A reply is either the whole text, or a stream of text chunks that the panel
 * appends as they arrive (so an LLM can type out its answer).
 */
export type AgentReply = string | AsyncIterable<string>;

export interface AgentAdapter {
  /** Stable key; conversations are stored per id. */
  id: string;
  /** Shown in the panel header (and the switcher when 2+ agents are attached). */
  name: string;
  description?: string;
  /** Prompt chips on the empty state. */
  suggestions?: string[];
  /** Composer placeholder. */
  placeholder?: string;
  /** Hide the agent for some users (e.g. admin-only tools). Default: available. */
  isAvailable?: (ctx: AgentContext) => boolean;
  /**
   * Answer the latest turn. `history` ends with the user's new message. Throw to
   * show the user an error; honor `signal` to stop work when the panel unmounts.
   * Runs in the browser, so reach the server through fetch or a server action.
   */
  send: (
    history: AgentTurn[],
    ctx: AgentContext,
    signal: AbortSignal
  ) => Promise<AgentReply> | AgentReply;
}
