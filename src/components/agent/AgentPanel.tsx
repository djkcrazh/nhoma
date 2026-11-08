"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Icon } from "@/components/ui/NhomaIcons";
import { useAgentPanel } from "@/stores/agentPanel";
import { AGENTS } from "@/lib/agent/registry";
import type { AgentContext, AgentMessage, AgentReply } from "@/lib/agent/types";

function greetingFor(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const NO_MESSAGES: AgentMessage[] = [];
const isStream = (r: AgentReply): r is AsyncIterable<string> => typeof r !== "string";

/**
 * The agent: a chatbot docked beside the page. Layout (docked / minimized /
 * maximized / closed, plus the sheet on small screens) is driven entirely by
 * CSS off <html data-agent> — see "Agent panel" in globals.css. This component
 * owns the chat UI and the buttons that change the mode.
 *
 * It does not know how any agent works. Agents plug in through AgentAdapter
 * (lib/agent/types.ts) and are listed in lib/agent/registry.ts; see the README
 * next to them. Each agent keeps its own conversation.
 */
export function AgentPanel({
  userName,
  farmName,
  role,
}: {
  userName: string;
  farmName: string;
  role: string;
}) {
  const { mode, hydrate, setMode, dismiss, closeSheet, openSheet } = useAgentPanel();
  const pathname = usePathname();
  const [threads, setThreads] = useState<Record<string, AgentMessage[]>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [greeting, setGreeting] = useState("Hello");
  const endRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);
  const abortRef = useRef<AbortController | null>(null);

  const ctx: AgentContext = useMemo(
    () => ({ userName, farmName, role, pathname }),
    [userName, farmName, role, pathname]
  );
  const agents = useMemo(() => AGENTS.filter((a) => a.isAvailable?.(ctx) ?? true), [ctx]);
  const agent = agents.find((a) => a.id === activeId) ?? agents[0];
  const messages = (agent && threads[agent.id]) || NO_MESSAGES;

  // Deferred so the post-hydration sync doesn't cascade renders (same pattern
  // as ThemeToggle). The greeting depends on the client's clock, so it can't be
  // rendered on the server without a hydration mismatch.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      hydrate();
      setGreeting(greetingFor(new Date().getHours()));
    });
    return () => cancelAnimationFrame(id);
  }, [hydrate]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  // Stop any in-flight request when the panel goes away.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy || !agent) return;

    const agentId = agent.id;
    const prior = (threads[agentId] ?? []).filter((m) => !m.pending && !m.error);
    const history = [...prior.map(({ role, text }) => ({ role, text })), { role: "user" as const, text: trimmed }];
    const replyId = nextId.current + 1;
    const update = (fn: (m: AgentMessage[]) => AgentMessage[]) =>
      setThreads((t) => ({ ...t, [agentId]: fn(t[agentId] ?? []) }));
    const patch = (p: Partial<AgentMessage>) =>
      update((m) => m.map((x) => (x.id === replyId ? { ...x, ...p } : x)));

    update((m) => [
      ...m,
      { id: nextId.current, role: "user", text: trimmed },
      { id: replyId, role: "agent", text: "", pending: true },
    ]);
    nextId.current += 2;
    setDraft("");
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await agent.send(history, ctx, controller.signal);
      if (isStream(result)) {
        let acc = "";
        for await (const chunk of result) {
          acc += chunk;
          patch({ text: acc, pending: false });
        }
        patch({ pending: false });
      } else {
        patch({ text: result, pending: false });
      }
    } catch {
      if (controller.signal.aborted) return;
      patch({ text: `Couldn't reach ${agent.name}. Try again.`, pending: false, error: true });
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }

  if (!agent) return null;

  const firstName = userName.trim().split(/\s+/)[0] || "there";
  const maximized = mode === "maximized";

  return (
    <>
      <aside className="agent-panel" aria-label="Agent">
        <div className="agent-head">
          {agents.length > 1 ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded-lg py-1 pl-1 pr-1.5 font-display text-[15px] font-semibold hover:bg-sunken disabled:opacity-60"
                  aria-label="Switch agent"
                >
                  {agent.name}
                  <Icon.ChevronDown size={13} className="text-ink-soft" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="start"
                  sideOffset={6}
                  className="card z-[60] min-w-60 p-1.5"
                  style={{ boxShadow: "var(--shadow-lg)" }}
                >
                  <DropdownMenu.RadioGroup value={agent.id} onValueChange={setActiveId}>
                    {agents.map((a) => (
                      <DropdownMenu.RadioItem
                        key={a.id}
                        value={a.id}
                        className="flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-sunken data-[state=checked]:bg-accent-soft"
                      >
                        <span className="mt-0.5 flex w-4 justify-center text-accent">
                          <DropdownMenu.ItemIndicator>
                            <Icon.Check size={14} />
                          </DropdownMenu.ItemIndicator>
                        </span>
                        <span>
                          <span className="block font-semibold">{a.name}</span>
                          {a.description && <span className="block text-xs text-ink-soft">{a.description}</span>}
                        </span>
                      </DropdownMenu.RadioItem>
                    ))}
                  </DropdownMenu.RadioGroup>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : (
            <span className="font-display text-[15px] font-semibold">{agent.name}</span>
          )}
          <span className="rounded-[5px] bg-accent-soft px-1.5 py-0.5 font-tag text-[10px] font-semibold uppercase tracking-[0.1em] text-accent">
            Beta
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              className="agent-iconbtn agent-desktop-only"
              onClick={() => setMode("minimized")}
              aria-label="Minimize agent"
              title="Minimize"
            >
              <Icon.PanelRight size={15} />
            </button>
            <button
              type="button"
              className="agent-iconbtn agent-desktop-only"
              onClick={() => setMode(maximized ? "docked" : "maximized")}
              aria-label={maximized ? "Restore agent size" : "Maximize agent"}
              title={maximized ? "Restore" : "Maximize"}
            >
              {maximized ? <Icon.Restore size={15} /> : <Icon.Maximize size={15} />}
            </button>
            <button
              type="button"
              className="agent-iconbtn"
              onClick={dismiss}
              aria-label="Close agent"
              title="Close"
            >
              <Icon.Close size={15} />
            </button>
          </div>
        </div>

        <div className="agent-body">
          {messages.length === 0 ? (
            <div className="agent-empty">
              <div className="agent-orb">
                <Icon.Sparkle size={24} />
              </div>
              <h2 className="font-display text-[22px] font-semibold">
                {greeting}, {firstName}
              </h2>
              <p className="mt-1.5 text-[15px] text-ink-soft">You can ask me anything about your herd.</p>
              {!!agent.suggestions?.length && (
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {agent.suggestions.map((s) => (
                    <button key={s} type="button" className="agent-chip" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="agent-thread" role="log" aria-live="polite">
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="agent-me">
                    {m.text}
                  </div>
                ) : (
                  <div key={m.id} className="flex gap-2.5">
                    <span className="mt-0.5 flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-accent-soft text-accent">
                      <Icon.Sparkle size={14} />
                    </span>
                    {m.pending && !m.text ? (
                      <p className="text-sm text-ink-faint motion-safe:animate-pulse">Thinking…</p>
                    ) : (
                      <p className={`whitespace-pre-wrap text-sm leading-relaxed ${m.error ? "text-overdue" : ""}`}>
                        {m.text}
                      </p>
                    )}
                  </div>
                )
              )}
              <div ref={endRef} />
            </div>
          )}

          <form
            className="agent-composer"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              rows={2}
              placeholder={agent.placeholder ?? "Ask about your herd…"}
              aria-label="Message the agent"
            />
            <button
              type="submit"
              className="agent-send"
              disabled={!draft.trim() || busy}
              aria-label="Send message"
            >
              <Icon.ArrowUp size={15} />
            </button>
          </form>
        </div>
      </aside>

      {/* Minimized: a slim rail that restores the docked panel */}
      <button
        type="button"
        className="agent-rail"
        onClick={() => setMode("docked")}
        aria-label="Open agent"
        title="Open agent"
      >
        <Icon.Sparkle size={18} />
        <span>Agent</span>
      </button>

      {/* Below 1280px the panel is a sheet/drawer, opened from here */}
      <button type="button" className="agent-fab" onClick={() => openSheet()} aria-label="Ask agent">
        <Icon.Sparkle size={18} />
        <span>Ask agent</span>
      </button>
      <div className="agent-backdrop" onClick={closeSheet} aria-hidden />
    </>
  );
}
