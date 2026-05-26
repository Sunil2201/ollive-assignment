"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  cancelConversation,
  deleteConversation,
  getConversation,
  listConversations,
  resumeConversation,
  stopConversation,
  streamMessage,
} from "@/lib/api";
import { PROVIDERS } from "@/lib/providers";
import type { Conversation, Message } from "@/types";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* ── Helper: provider badge styles ── */
function getProviderStyle(provider: string): React.CSSProperties {
  const map: Record<string, React.CSSProperties> = {
    anthropic: {
      backgroundColor: "var(--color-anthropic-bg)",
      color: "var(--color-anthropic-text)",
    },
    openai: {
      backgroundColor: "var(--color-openai-bg)",
      color: "var(--color-openai-text)",
    },
    gemini: {
      backgroundColor: "var(--color-gemini-bg)",
      color: "var(--color-gemini-text)",
    },
  };
  return map[provider] ?? { backgroundColor: "var(--color-accent-subtle)", color: "var(--color-accent-text)" };
}

/* ── Helper: status badge styles ── */
function getStatusStyle(status: string): React.CSSProperties {
  return status === "cancelled"
    ? {
        backgroundColor: "var(--color-cancelled-bg)",
        color: "var(--color-cancelled-text)",
      }
    : {
        backgroundColor: "var(--color-active-bg)",
        color: "var(--color-active-text)",
      };
}

/* ── Streaming 3-dot indicator ── */
function StreamingDots() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "3px",
        marginLeft: "6px",
        verticalAlign: "middle",
      }}
    >
      <span className="streaming-dot" />
      <span className="streaming-dot" />
      <span className="streaming-dot" />
    </span>
  );
}

/* ── Spinner for send button ── */
function Spinner() {
  return (
    <svg
      style={{ width: "14px", height: "14px" }}
      className="animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        style={{ opacity: 0.25 }}
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        style={{ opacity: 0.75 }}
        fill="currentColor"
        d="M4 12a8 8 0 018-8v8H4z"
      />
    </svg>
  );
}

/* ── Plus icon for new chat button ── */
function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M7 1v12M1 7h12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ── Chat bubble icon for empty state ── */
function ChatBubbleIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "var(--color-text-hint)" }}
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════════
   Input Bar — shared between empty-state (top) and message view (bottom)
══════════════════════════════════════════════════════════════ */
interface InputBarContentsProps {
  activeConv: Conversation | null;
  cancelledError: string | null;
  setCancelledError: (v: string | null) => void;
  input: string;
  setInput: (v: string) => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  isDisabled: boolean;
  streaming: boolean;
  handleStop: () => void;
  handleSend: () => void;
  selectedProvider: string;
  setSelectedProvider: (v: string) => void;
}

/* Provider badge for sidebar conversation items */
function ProviderDot({ provider }: { provider?: string | null }) {
  if (!provider) return null;
  const map: Record<string, { bg: string; text: string; label: string }> = {
    anthropic: { bg: "var(--color-anthropic-bg)", text: "var(--color-anthropic-text)", label: "Anthropic" },
    openai:    { bg: "var(--color-openai-bg)",    text: "var(--color-openai-text)",    label: "OpenAI"    },
    gemini:    { bg: "var(--color-gemini-bg)",    text: "var(--color-gemini-text)",    label: "Gemini"    },
  };
  const style = map[provider.toLowerCase()] ?? {
    bg: "var(--color-accent-subtle)",
    text: "var(--color-accent-text)",
    label: provider,
  };
  return (
    <span
      style={{
        display: "inline-block",
        alignSelf: "flex-start",
        fontSize: "10px",
        fontWeight: 500,
        lineHeight: 1,
        padding: "2px 6px",
        borderRadius: "var(--radius-pill)",
        background: style.bg,
        color: style.text,
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      {style.label}
    </span>
  );
}

function InputBarContents({
  activeConv,
  cancelledError,
  setCancelledError,
  input,
  setInput,
  handleKeyDown,
  isDisabled,
  streaming,
  handleStop,
  handleSend,
  selectedProvider,
  setSelectedProvider,
}: InputBarContentsProps) {
  return (
    <>
      {/* Inline error for blocked sends on cancelled conversations */}
      {cancelledError && (
        <div
          style={{
            marginBottom: "8px",
            padding: "8px 12px",
            borderRadius: "var(--radius-md)",
            background: "var(--color-cancelled-bg)",
            color: "var(--color-cancelled-text)",
            fontSize: "12px",
            fontWeight: 500,
          }}
        >
          {cancelledError}
        </div>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: "var(--radius-lg)",
          padding: "14px 14px 10px 16px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
          transition: "opacity 200ms ease",
          gap: "10px",
        }}
      >
        {/* Top row — textarea */}
        <textarea
          className="chat-input"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (cancelledError) setCancelledError(null);
          }}
          onKeyDown={handleKeyDown}
          disabled={isDisabled}
          placeholder={
            activeConv?.status === "cancelled"
              ? "Type 'resume' to continue..."
              : "Ask anything..."
          }
          rows={2}
          style={{
            width: "100%",
            border: "none",
            outline: "none",
            background: "transparent",
            resize: "none",
            fontSize: "14px",
            color: "var(--color-text-primary)",
            lineHeight: 1.6,
            maxHeight: "160px",
            overflowY: "auto",
            padding: 0,
            fontFamily: "inherit",
          }}
        />

        {/* Bottom row — provider select + send/stop */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {/* Provider Select */}
          <Select
            value={selectedProvider}
            onValueChange={(v) => { if (v !== null) setSelectedProvider(v); }}
            disabled={isDisabled}
          >
            <SelectTrigger className="model-select-trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="model-select-content">
              {PROVIDERS.map((p) => (
                <SelectItem key={p.value} value={p.value} className="model-select-item" label={p.label} data-value={p.value}>
                  <span>{p.label}</span>
                  <span style={{ fontSize: "11px", fontWeight: 400, opacity: 0.55, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                    {p.model}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Send / Stop — only rendered when there's input or actively streaming */}
          {(streaming || input.trim()) && (
            <button
              onClick={streaming ? handleStop : handleSend}
              disabled={!streaming && isDisabled}
              style={{
                background: streaming ? "#dc2626" : "var(--color-accent)",
                color: "#FFFFFF",
                border: "none",
                borderRadius: "var(--radius-md)",
                padding: "0 16px",
                fontSize: "13px",
                fontWeight: 500,
                cursor: !streaming && isDisabled ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "4px",
                transition: "all 120ms ease",
                flexShrink: 0,
                minWidth: "52px",
                height: "34px",
                opacity: !streaming && isDisabled ? 0.6 : 1,
              }}
              onMouseEnter={(e) => {
                if (!isDisabled || streaming) {
                  e.currentTarget.style.background = streaming
                    ? "#b91c1c"
                    : "var(--color-accent-hover)";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = streaming
                  ? "#dc2626"
                  : "var(--color-accent)";
              }}
            >
              {streaming ? "Stop" : "Send"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   Main Component
══════════════════════════════════════════════════════════════ */
export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [sidebarError, setSidebarError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState("Anthropic");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [recentsOpen, setRecentsOpen] = useState(true);
  const [hoveredConvId, setHoveredConvId] = useState<string | null>(null);
  const [dotHoveredConvId, setDotHoveredConvId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [cancelledError, setCancelledError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Ref mirror of streamingContent — handleStop reads this instead of the state
  // variable to avoid stale-closure issues when chunks arrive faster than renders.
  const streamingContentRef = useRef("");

  /* Derived */
  const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;
  const providerLabel =
    PROVIDERS.find((p) => p.value === selectedProvider)?.label ?? selectedProvider;
  const filteredConversations = conversations.filter((c) =>
    (c.title ?? "Untitled").toLowerCase().includes(searchQuery.toLowerCase())
  );

  /* Load conversations on mount */
  useEffect(() => {
    refreshConversations();
  }, []);

  /* Close context menu on outside click */
  useEffect(() => {
    if (!menuOpenId) return;
    function onMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [menuOpenId]);

  /* Auto-scroll to bottom */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  async function refreshConversations() {
    try {
      const data = await listConversations();
      setConversations(data);
      setSidebarError(null);
    } catch {
      setSidebarError("Failed to load conversations.");
    }
  }

  async function handleDeleteConversation(id: string) {
    setIsDeleting(true);
    try {
      await deleteConversation(id);
      setConfirmDeleteId(null);
      setMenuOpenId(null);
      if (activeConvId === id) {
        setActiveConvId(null);
        setMessages([]);
      }
      await refreshConversations();
    } catch { /* ignore */ } finally {
      setIsDeleting(false);
    }
  }

  async function handleSelectConversation(id: string) {
    setActiveConvId(id);
    try {
      const data = await getConversation(id);
      setMessages(data.messages ?? []);
    } catch {
      setMessages([]);
    }
  }

  function handleNewChat() {
    setActiveConvId(crypto.randomUUID());
    setMessages([]);
  }

  async function handleCancel(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await cancelConversation(id);
      await refreshConversations();
    } catch {
      /* ignore */
    }
  }

  async function handleStop() {
    if (!abortControllerRef.current) return;
    // Abort the fetch — the SSE read loop will throw AbortError and call onAbort
    abortControllerRef.current.abort();
    abortControllerRef.current = null;

    // Read from the ref — guaranteed to be the latest accumulated content regardless
    // of how many renders have (or haven't) happened since the last chunk arrived.
    const partial = streamingContentRef.current;
    streamingContentRef.current = "";
    setStreamingContent("");
    setStreaming(false);

    // Immediately show whatever tokens arrived as a proper message bubble —
    // no gap while waiting for the DB round-trip
    if (partial && activeConvId) {
      const optimisticMsg: Message = {
        id: crypto.randomUUID(),
        conversation_id: activeConvId,
        role: "assistant",
        content: partial,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimisticMsg]);
    }

    if (activeConvId) {
      let savedToDb = false;
      try {
        await stopConversation(activeConvId, partial);
        savedToDb = true;
      } catch {
        /* ignore — conversation will be marked cancelled even if partial wasn't saved */
      }
      await refreshConversations();
      // Only replace the optimistic message with the DB version if the save succeeded.
      // If it failed, keep the optimistic message so the user still sees the partial.
      if (savedToDb) {
        try {
          const data = await getConversation(activeConvId);
          setMessages(data.messages ?? []);
        } catch {
          /* keep current messages */
        }
      }
    }
  }

  const RESUME_RE = /\b(resume|continue|please continue|go on|keep going|carry on)\b/i;

  async function handleSend() {
    const text = input.trim();
    if (!text || loading || streaming) return;

    // Track whether this send is a resume so we can tell the backend
    let isResume = false;
    // Track whether this is a brand-new conversation (unrelated message on a cancelled conv)
    let isNewConversation = false;

    // Handle cancelled conversation: resume if intent detected, otherwise start fresh
    if (activeConv?.status === "cancelled") {
      if (RESUME_RE.test(text)) {
        // Resume intent detected — flip status back to active first
        setCancelledError(null);
        try {
          await resumeConversation(activeConvId!);
          await refreshConversations();
        } catch {
          setCancelledError("Failed to resume conversation. Please try again.");
          return;
        }
        isResume = true;
      } else {
        // Unrelated message — start a brand-new conversation instead of blocking
        setCancelledError(null);
        isNewConversation = true;
      }
    }

    setCancelledError(null);

    const convId = isNewConversation
      ? crypto.randomUUID()
      : (activeConvId ?? crypto.randomUUID());

    if (!activeConvId || isNewConversation) setActiveConvId(convId);

    // For a new conversation, start with an empty history; otherwise carry forward existing messages
    const baseMessages = isNewConversation ? [] : messages;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      conversation_id: convId,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };

    const nextMessages = [...baseMessages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setStreaming(true);
    streamingContentRef.current = "";
    setStreamingContent("");

    const controller = new AbortController();
    abortControllerRef.current = controller;

    await streamMessage(
      {
        messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        conversationId: convId,
        provider: selectedProvider.toLowerCase(),
        isResume,
      },
      (chunk) => {
        streamingContentRef.current += chunk;
        setStreamingContent((prev) => prev + chunk);
      },
      async () => {
        abortControllerRef.current = null;
        streamingContentRef.current = "";
        setStreamingContent("");
        setStreaming(false);
        try {
          const data = await getConversation(convId);
          if (isResume) {
            // Merge: keep any optimistic assistant messages (e.g. the stopped partial)
            // that exist locally but never made it to the DB (e.g. if stopConversation
            // failed). Sort by created_at so the partial stays in the right position.
            setMessages((prev) => {
              const dbIds = new Set((data.messages ?? []).map((m) => m.id));
              const localOnly = prev.filter(
                (m) => !dbIds.has(m.id) && m.role === "assistant"
              );
              if (localOnly.length === 0) return data.messages ?? [];
              const merged = [...localOnly, ...(data.messages ?? [])];
              merged.sort(
                (a, b) =>
                  new Date(a.created_at).getTime() -
                  new Date(b.created_at).getTime()
              );
              return merged;
            });
          } else {
            setMessages(data.messages ?? []);
          }
        } catch {
          /* keep current */
        }
        await refreshConversations();
      },
      (error) => {
        abortControllerRef.current = null;
        streamingContentRef.current = "";
        setStreamingContent("");
        setStreaming(false);
        const errMessage: Message = {
          id: crypto.randomUUID(),
          conversation_id: convId,
          role: "assistant",
          content: `Error: ${error}`,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errMessage]);
      },
      () => {
        // onAbort: handleStop() already cleans up state; just clear the ref here
        abortControllerRef.current = null;
      },
      controller.signal
    );
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const isDisabled = loading || streaming;
  const hasMessages = messages.length > 0 || !!streamingContent;

  /* ══════════════════════════════════════════════════════════════
     Render
  ══════════════════════════════════════════════════════════════ */
  return (
    <TooltipProvider delay={300}>
      {/* Root: full viewport, sidebar + main side-by-side */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          height: "100vh",
          overflow: "hidden",
          background: "var(--color-page-bg)",
        }}
      >
        {/* ══════════════════════════════════════
            SIDEBAR (full height)
        ══════════════════════════════════════ */}
        {sidebarOpen && (
          <aside
            style={{
              width: "var(--sidebar-width)",
              minWidth: "var(--sidebar-width)",
              display: "flex",
              flexDirection: "column",
              background: "var(--color-sidebar-bg)",
              borderRight: "1px solid var(--color-border)",
              flexShrink: 0,
              overflow: "hidden",
            }}
          >
            {/* ── Sidebar Header ── */}
            <div
              style={{
                height: "var(--nav-height)",
                minHeight: "var(--nav-height)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 8px 0 16px",
                borderBottom: "1px solid var(--color-border)",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontSize: "15px",
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                  letterSpacing: "-0.01em",
                }}
              >
                Prism
              </span>
              <Tooltip>
                <TooltipTrigger render={<span />}>
                  <button
                    onClick={() => setSidebarOpen(false)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: "6px",
                      borderRadius: "var(--radius-md)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--color-text-secondary)",
                      transition: "background 120ms ease",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "rgba(15,23,42,0.06)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "none")
                    }
                    aria-label="Close sidebar"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <line x1="9" y1="3" x2="9" y2="21" />
                    </svg>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Close sidebar</TooltipContent>
              </Tooltip>
            </div>

            {/* ── Sidebar Body ── */}
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                padding: "12px",
                gap: "8px",
                overflowY: "auto",
                overflowX: "hidden",
              }}
            >
              {/* New chat — plain icon+text row */}
              <button
                onClick={handleNewChat}
                style={{
                  width: "100%",
                  height: "36px",
                  background: "none",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "0 10px",
                  color: "var(--color-text-primary)",
                  fontSize: "14px",
                  fontWeight: 400,
                  flexShrink: 0,
                  transition: "background 120ms ease",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#E8EBF4")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "none")
                }
              >
                {/* Circle-plus icon */}
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ flexShrink: 0, color: "var(--color-text-secondary)" }}
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v8M8 12h8" />
                </svg>
                <span>New chat</span>
              </button>

              {/* Search row — transforms into inline input when active */}
              {searchOpen ? (
                <div
                  style={{
                    width: "100%",
                    height: "36px",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "0 10px",
                    background: "rgba(255,255,255,0.7)",
                    border: "1px solid var(--color-accent)",
                    borderRadius: "var(--radius-md)",
                    flexShrink: 0,
                    boxSizing: "border-box",
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ flexShrink: 0, color: "var(--color-accent)" }}
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                  <input
                    autoFocus
                    type="text"
                    placeholder="Search conversations..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setSearchOpen(false);
                        setSearchQuery("");
                      }
                    }}
                    style={{
                      flex: 1,
                      border: "none",
                      outline: "none",
                      background: "transparent",
                      fontSize: "14px",
                      color: "var(--color-text-primary)",
                      fontFamily: "inherit",
                    }}
                  />
                  {/* Clear / close */}
                  <button
                    onClick={() => { setSearchOpen(false); setSearchQuery(""); }}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: "2px",
                      display: "flex",
                      alignItems: "center",
                      color: "var(--color-text-hint)",
                      borderRadius: "4px",
                      flexShrink: 0,
                    }}
                    aria-label="Close search"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setSearchOpen(true)}
                  style={{
                    width: "100%",
                    height: "36px",
                    background: "none",
                    border: "none",
                    borderRadius: "var(--radius-md)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "0 10px",
                    color: "var(--color-text-primary)",
                    fontSize: "14px",
                    fontWeight: 400,
                    flexShrink: 0,
                    transition: "background 120ms ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#E8EBF4")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ flexShrink: 0, color: "var(--color-text-secondary)" }}
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                  <span>Search</span>
                </button>
              )}

              {/* Sidebar load error */}
              {sidebarError && (
                <div
                  style={{
                    padding: "6px 12px",
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-cancelled-bg)",
                    color: "var(--color-cancelled-text)",
                    fontSize: "12px",
                    fontWeight: 500,
                  }}
                >
                  {sidebarError}
                </div>
              )}

              {/* Recents label — collapsible */}
              {filteredConversations.length > 0 && (
                <button
                  onClick={() => setRecentsOpen((v) => !v)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    width: "100%",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "4px 4px 0",
                    marginTop: "4px",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "var(--color-text-hint)",
                    }}
                  >
                    Recents
                  </span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      color: "var(--color-text-hint)",
                      transform: recentsOpen ? "rotate(0deg)" : "rotate(-90deg)",
                      transition: "transform 180ms ease",
                    }}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              )}

              {/* Conversation list */}
              <div
                style={{
                  display: recentsOpen ? "flex" : "none",
                  flexDirection: "column",
                  gap: "2px",
                  flex: 1,
                  overflowY: "auto",
                }}
              >
                {filteredConversations.map((conv) => {
                  const isActive = conv.id === activeConvId;
                  const isHovered = hoveredConvId === conv.id;
                  const isMenuOpen = menuOpenId === conv.id;
                  const isDotHovered = dotHoveredConvId === conv.id;
                  return (
                    <div
                      key={conv.id}
                      style={{ position: "relative" }}
                    >
                      {/* Row button */}
                      <button
                        onClick={() => handleSelectConversation(conv.id)}
                        onMouseEnter={() => setHoveredConvId(conv.id)}
                        onMouseLeave={() => {
                          if (!isMenuOpen) setHoveredConvId(null);
                        }}
                        style={{
                          width: "100%",
                          padding: "8px 32px 8px 12px",
                          borderRadius: "var(--radius-md)",
                          border: "none",
                          background: isActive
                            ? "var(--color-accent-subtle)"
                            : isHovered || isMenuOpen ? "#E8EBF4" : "transparent",
                          color: isActive
                            ? "var(--color-accent-text)"
                            : isHovered || isMenuOpen ? "var(--color-text-primary)" : "var(--color-text-sidebar)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          textAlign: "left",
                          fontSize: "13px",
                          fontWeight: isActive ? 500 : 400,
                          transition: "all 120ms ease",
                          overflow: "hidden",
                        }}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{ flexShrink: 0, opacity: 0.7, marginTop: "1px" }}
                        >
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {conv.title || "Untitled"}
                          </span>
                          <ProviderDot provider={conv.primary_provider} />
                        </div>
                      </button>

                      {/* Three-dot button — visible on row hover, dot hover, or when menu is open */}
                      {(isHovered || isDotHovered || isMenuOpen) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpenId(isMenuOpen ? null : conv.id);
                          }}
                          onMouseEnter={() => {
                            setDotHoveredConvId(conv.id);
                            setHoveredConvId(null);
                          }}
                          onMouseLeave={() => {
                            setDotHoveredConvId(null);
                          }}
                          style={{
                            position: "absolute",
                            right: "4px",
                            top: "50%",
                            transform: "translateY(-50%)",
                            background: isDotHovered || isMenuOpen ? "rgba(15,23,42,0.08)" : "none",
                            border: "none",
                            cursor: "pointer",
                            padding: "6px 8px",
                            borderRadius: "var(--radius-sm)",
                            color: "var(--color-text-secondary)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            lineHeight: 1,
                          }}
                          aria-label="More options"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="5" r="1.5" />
                            <circle cx="12" cy="12" r="1.5" />
                            <circle cx="12" cy="19" r="1.5" />
                          </svg>
                        </button>
                      )}

                      {/* Dropdown menu */}
                      {isMenuOpen && (
                        <div
                          ref={menuRef}
                          style={{
                            position: "absolute",
                            right: 0,
                            top: "calc(100% + 4px)",
                            zIndex: 50,
                            background: "#FFFFFF",
                            border: "1px solid var(--color-border)",
                            borderRadius: "var(--radius-md)",
                            boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
                            minWidth: "160px",
                            padding: "4px",
                          }}
                        >
                          <button
                            onClick={() => { setConfirmDeleteId(conv.id); setMenuOpenId(null); }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              width: "100%",
                              padding: "8px 10px",
                              background: "none",
                              border: "none",
                              borderRadius: "6px",
                              cursor: "pointer",
                              fontSize: "13px",
                              fontWeight: 400,
                              color: "#DC2626",
                              textAlign: "left",
                            }}
                            onMouseEnter={(e) =>
                              (e.currentTarget.style.background = "#FEF2F2")
                            }
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.background = "none")
                            }
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                              <path d="M10 11v6M14 11v6" />
                              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                            </svg>
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>
        )}

        {/* ══════════════════════════════════════
            MAIN CONTENT COLUMN
        ══════════════════════════════════════ */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minWidth: 0,
            background: "var(--color-page-bg)",
          }}
        >
          {/* ── Top nav bar (same bg as page — no white stripe) ── */}
          <nav
            style={{
              height: "var(--nav-height)",
              minHeight: "var(--nav-height)",
              background: "var(--color-page-bg)",
              borderBottom: "1px solid var(--color-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 20px",
              flexShrink: 0,
            }}
          >
            {/* Left: toggle when sidebar is closed */}
            <div>
              {!sidebarOpen && (
                <Tooltip>
                  <TooltipTrigger render={<span />}>
                    <button
                      onClick={() => setSidebarOpen(true)}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: "6px",
                        borderRadius: "var(--radius-md)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--color-text-secondary)",
                        transition: "background 120ms ease",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = "rgba(15,23,42,0.06)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "none")
                      }
                      aria-label="Open sidebar"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <line x1="9" y1="3" x2="9" y2="21" />
                      </svg>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Open sidebar</TooltipContent>
                </Tooltip>
              )}
            </div>

            {/* Right: Dashboard link + active conversation pill */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <Link
                href="/dashboard"
                style={{
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "var(--color-accent)",
                  textDecoration: "none",
                }}
              >
                Dashboard
              </Link>

            </div>
          </nav>

          {/* ── CHAT AREA ── */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              minWidth: 0,
            }}
          >
            {/* Chat header — only if a conversation is selected */}
            {activeConv && (
              <div
                style={{
                  background: "var(--color-page-bg)",
                  display: "flex",
                  alignItems: "center",
                  padding: "12px 24px",
                  flexShrink: 0,
                }}
              >
                {/* Left: conversation title */}
                <span
                  style={{
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "var(--color-text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "50%",
                  }}
                >
                  {activeConv.title || "Untitled"}
                </span>

              </div>
            )}

            {/* Messages area */}
            <ScrollArea
              style={{
                flex: 1,
                minHeight: 0,
              }}
            >
              <div
                style={{
                  maxWidth: "780px",
                  margin: "0 auto",
                  padding: "24px 20px",
                }}
              >
                {/* Empty state */}
                {!hasMessages && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "16px",
                      minHeight: "300px",
                      textAlign: "center",
                      padding: "0 24px",
                    }}
                  >
                    {/* Sparkle icon in accent pill */}
                    <div
                      style={{
                        width: "48px",
                        height: "48px",
                        borderRadius: "50%",
                        background: "var(--color-accent-subtle)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        style={{ color: "var(--color-accent)" }}
                      >
                        <path d="M12 2 L13.5 10.5 L22 12 L13.5 13.5 L12 22 L10.5 13.5 L2 12 L10.5 10.5 Z" />
                      </svg>
                    </div>

                    <p
                      style={{
                        fontSize: "22px",
                        fontWeight: 600,
                        color: "var(--color-text-primary)",
                        margin: 0,
                        lineHeight: 1.3,
                      }}
                    >
                      How can I help you today?
                    </p>

                    {/* Input bar lives here when there are no messages */}
                    <div style={{ width: "100%", maxWidth: "780px", marginTop: "8px" }}>
                      <InputBarContents
                        activeConv={activeConv}
                        cancelledError={cancelledError}
                        setCancelledError={setCancelledError}
                        input={input}
                        setInput={setInput}
                        handleKeyDown={handleKeyDown}
                        isDisabled={isDisabled}
                        streaming={streaming}
                        handleStop={handleStop}
                        handleSend={handleSend}
                        selectedProvider={selectedProvider}
                        setSelectedProvider={setSelectedProvider}
                      />
                    </div>
                  </div>
                )}

                {/* Message list */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "16px",
                  }}
                >
                  {messages.map((msg) => {
                    const isUser = msg.role === "user";
                    return (
                      <div
                        key={msg.id}
                        style={{
                          display: "flex",
                          justifyContent: isUser ? "flex-end" : "flex-start",
                        }}
                      >
                        {isUser ? (
                          /* User bubble */
                          <div
                            style={{
                              maxWidth: "72%",
                              padding: "10px 14px",
                              fontSize: "14px",
                              lineHeight: 1.6,
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              borderRadius:
                                "var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg)",
                              background: "var(--color-accent)",
                              color: "#FFFFFF",
                            }}
                          >
                            {msg.content}
                          </div>
                        ) : (
                          /* Assistant response — no bubble */
                          <div
                            style={{
                              width: "100%",
                              fontSize: "14px",
                              lineHeight: 1.6,
                              color: "var(--color-text-primary)",
                              wordBreak: "break-word",
                            }}
                          >
                            <MarkdownRenderer content={msg.content} />
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Streaming assistant response — no bubble */}
                  {streaming && (
                    <div
                      style={{
                        width: "100%",
                        fontSize: "14px",
                        lineHeight: 1.6,
                        color: "var(--color-text-primary)",
                        wordBreak: "break-word",
                      }}
                    >
                      {streamingContent
                        ? <MarkdownRenderer content={streamingContent} />
                        : (
                          <span style={{ color: "var(--color-text-hint)", fontStyle: "italic" }}>
                            Thinking
                          </span>
                        )
                      }
                      <StreamingDots />
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </div>
            </ScrollArea>

            {/* ── INPUT BAR (bottom) — only shown once there are messages ── */}
            {hasMessages && (
              <div
                style={{
                  padding: "12px 20px 16px",
                  background: "var(--color-page-bg)",
                  flexShrink: 0,
                }}
              >
                <div style={{ maxWidth: "780px", margin: "0 auto" }}>
                  <InputBarContents
                    activeConv={activeConv}
                    cancelledError={cancelledError}
                    setCancelledError={setCancelledError}
                    input={input}
                    setInput={setInput}
                    handleKeyDown={handleKeyDown}
                    isDisabled={isDisabled}
                    streaming={streaming}
                    handleStop={handleStop}
                    handleSend={handleSend}
                    selectedProvider={selectedProvider}
                    setSelectedProvider={setSelectedProvider}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════
          DELETE CONFIRMATION MODAL
      ══════════════════════════════════════ */}
      <Dialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}
      >
        <DialogPopup>
          <DialogTitle>Delete Conversation</DialogTitle>
          <DialogDescription>
            This conversation and all its messages will be permanently deleted.
            This action cannot be undone.
          </DialogDescription>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
            <DialogClose
              style={{
                padding: "7px 16px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--color-border)",
                background: "transparent",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: 500,
                color: "var(--color-text-primary)",
              }}
            >
              Cancel
            </DialogClose>
            <button
              onClick={() => !isDeleting && confirmDeleteId && handleDeleteConversation(confirmDeleteId)}
              disabled={isDeleting}
              style={{
                padding: "7px 16px",
                borderRadius: "var(--radius-md)",
                border: "none",
                background: isDeleting ? "#EF4444" : "#DC2626",
                cursor: isDeleting ? "not-allowed" : "pointer",
                fontSize: "13px",
                fontWeight: 500,
                color: "#FFFFFF",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                opacity: isDeleting ? 0.85 : 1,
              }}
              onMouseEnter={(e) => { if (!isDeleting) e.currentTarget.style.background = "#B91C1C"; }}
              onMouseLeave={(e) => { if (!isDeleting) e.currentTarget.style.background = "#DC2626"; }}
            >
              {isDeleting && (
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  style={{
                    animation: "spin 0.7s linear infinite",
                    flexShrink: 0,
                  }}
                >
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              )}
              {isDeleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </DialogPopup>
      </Dialog>
    </TooltipProvider>
  );
}
