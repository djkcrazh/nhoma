"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/NhomaIcons";
import { useAgentPanel } from "@/stores/agentPanel";

const SUGGESTIONS = [
  "Who farrows this week?",
  "Who's ready for market?",
  "Log a weigh-in",
  "Summarize this week",
];

interface Message {
  id: number;
  from: "me" | "agent";
  text: string;
}

function greetingFor(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * The agent: a chatbot docked beside the page. Layout (docked / minimized /
 * maximized / closed, plus the sheet on small screens) is driven entirely by
 * CSS off <html data-agent> — see "Agent panel" in globals.css. This component
 * only owns the chat UI and the buttons that change the mode.
 *
 * The backend doesn't exist yet, so sending a message gets a clearly-labelled
 * placeholder reply. Replace `reply()` with the real call when it lands.
 */
export function AgentPanel({ userName }: { userName: string }) {
  const { mode, hydrate, setMode, dismiss, closeSheet, openSheet } = useAgentPanel();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [greeting, setGreeting] = useState("Hello");
  const endRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

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

  function reply(): string {
    return "I'm not connected yet. This chat is a preview, so I can't look anything up for now.";
  }

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const me: Message = { id: nextId.current++, from: "me", text: trimmed };
    const agent: Message = { id: nextId.current++, from: "agent", text: reply() };
    setMessages((m) => [...m, me]);
    setDraft("");
    window.setTimeout(() => setMessages((m) => [...m, agent]), 350);
  }

  const firstName = userName.trim().split(/\s+/)[0] || "there";
  const maximized = mode === "maximized";

  return (
    <>
      <aside className="agent-panel" aria-label="Agent">
        <div className="agent-head">
          <span className="font-display text-[15px] font-semibold">Agent</span>
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
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="agent-chip" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="agent-thread" role="log" aria-live="polite">
              {messages.map((m) =>
                m.from === "me" ? (
                  <div key={m.id} className="agent-me">
                    {m.text}
                  </div>
                ) : (
                  <div key={m.id} className="flex gap-2.5">
                    <span className="mt-0.5 flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-accent-soft text-accent">
                      <Icon.Sparkle size={14} />
                    </span>
                    <p className="text-sm leading-relaxed">{m.text}</p>
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
              placeholder="Ask about your herd…"
              aria-label="Message the agent"
            />
            <button
              type="submit"
              className="agent-send"
              disabled={!draft.trim()}
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
      <button type="button" className="agent-fab" onClick={openSheet} aria-label="Ask agent">
        <Icon.Sparkle size={18} />
        <span>Ask agent</span>
      </button>
      <div className="agent-backdrop" onClick={closeSheet} aria-hidden />
    </>
  );
}
