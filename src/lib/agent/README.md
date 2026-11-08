# Attaching an agent

The Agent panel (`components/agent/AgentPanel.tsx`) is only the chat UI. Agents plug in through the `AgentAdapter` contract in `types.ts`, so nothing in the panel changes when you attach one.

## Steps

1. Create `src/lib/agent/<name>.ts` exporting an `AgentAdapter`.
2. Add it to `AGENTS` in `registry.ts`. Remove `placeholderAgent` when you no longer want it.

That's it. With two or more agents the panel header shows a switcher and each agent keeps its own conversation.

## Example: a streaming agent behind an API route

```ts
import type { AgentAdapter } from "./types";

export const farmAssistant: AgentAdapter = {
  id: "farm-assistant",
  name: "Farm assistant",
  suggestions: ["Who farrows this week?", "Summarize this week"],
  async send(history, ctx, signal) {
    const res = await fetch("/api/agent/farm-assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history, pathname: ctx.pathname }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error("agent request failed");
    return stream(res.body); // AsyncIterable<string>: chunks are appended as they arrive
  },
};

async function* stream(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    yield decoder.decode(value, { stream: true });
  }
}
```

Return a plain `string` instead if the agent doesn't stream.

## What the adapter gets

- `history`: the conversation so far, ending with the user's new message. Plain `{ role, text }` turns.
- `ctx`: `{ userName, farmName, role, pathname }`. Add fields to `AgentContext` (and pass them in `AgentPanel`) when an agent needs more.
- `signal`: aborted when the panel unmounts; pass it to `fetch`.

## Rules

- Adapters run in the browser. Reach the server with `fetch` or a server action, and do auth and farm scoping there (`requireCtx()`, as the other actions do). Never trust `ctx` for authorization: it's client-supplied.
- Throwing shows the user "Couldn't reach <name>. Try again." in the thread.
- Limit who sees an agent with `isAvailable(ctx)`.
