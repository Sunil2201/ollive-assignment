"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  cancelConversation,
  getConversation,
  listConversations,
  streamMessage,
} from "@/lib/api";
import { PROVIDERS } from "@/lib/providers";
import type { Conversation, Message } from "@/types";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
  const [selectedProvider, setSelectedProvider] = useState("anthropic");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  /* Derived */
  const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;
  const providerLabel =
    PROVIDERS.find((p) => p.value === selectedProvider)?.label ?? selectedProvider;

  /* Load conversations on mount */
  useEffect(() => {
    refreshConversations();
  }, []);

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

  async function handleSend() {
    const text = input.trim();
    if (!text || loading || streaming) return;

    const convId = activeConvId ?? crypto.randomUUID();
    if (!activeConvId) setActiveConvId(convId);

    const userMessage: Message = {
      id: crypto.randomUUID(),
      conversation_id: convId,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setStreaming(true);
    setStreamingContent("");

    await streamMessage(
      {
        messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        conversationId: convId,
        provider: selectedProvider,
      },
      (chunk) => {
        setStreamingContent((prev) => prev + chunk);
      },
      async () => {
        setStreamingContent("");
        setStreaming(false);
        try {
          const data = await getConversation(convId);
          setMessages(data.messages ?? []);
        } catch {
          /* keep current */
        }
        await refreshConversations();
      },
      (error) => {
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
      }
    );
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const isDisabled = loading || streaming;

  /* ══════════════════════════════════════════════════════════════
     Render
  ══════════════════════════════════════════════════════════════ */
  return (
    <TooltipProvider delay={300}>
      {/* Root: full viewport, no scroll */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          overflow: "hidden",
          background: "var(--color-page-bg)",
        }}
      >
        {/* ══════════════════════════════════════
            NAV BAR
        ══════════════════════════════════════ */}
        <nav
          style={{
            height: "var(--nav-height)",
            minHeight: "var(--nav-height)",
            background: "#FFFFFF",
            borderBottom: "0.5px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 24px",
            flexShrink: 0,
          }}
        >
          {/* Left: Toggle button + brand name */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
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
                (e.currentTarget.style.background = "var(--color-sidebar-bg)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "none")
              }
              aria-label="Toggle sidebar"
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
            <span
              style={{
                fontSize: "14px",
                fontWeight: 500,
                color: "var(--color-text-primary)",
                letterSpacing: "-0.01em",
              }}
            >
              llm-logger
            </span>
          </div>

          {/* Right: Dashboard link + active conversation pill */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <Link
              href="/dashboard"
              style={{
                fontSize: "13px",
                color: "var(--color-accent)",
                textDecoration: "none",
              }}
            >
              Dashboard
            </Link>

            {activeConv && (
              <span
                style={{
                  fontSize: "13px",
                  color: "var(--color-text-secondary)",
                  background: "var(--color-sidebar-bg)",
                  borderRadius: "var(--radius-pill)",
                  padding: "2px 10px",
                  maxWidth: "200px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {activeConv.title || "Untitled"}
              </span>
            )}
          </div>
        </nav>

        {/* ══════════════════════════════════════
            BODY (sidebar + chat)
        ══════════════════════════════════════ */}
        <div
          style={{
            display: "flex",
            flex: 1,
            overflow: "hidden",
            minHeight: 0,
          }}
        >
          {/* ── SIDEBAR ── */}
          <aside
            style={{
              width: sidebarOpen ? "var(--sidebar-width)" : "0px",
              minWidth: sidebarOpen ? "var(--sidebar-width)" : "0px",
              background: "var(--color-sidebar-bg)",
              borderRight: sidebarOpen ? "0.5px solid var(--color-border)" : "none",
              display: sidebarOpen ? "flex" : "none",
              flexDirection: "column",
              alignItems: "stretch",
              padding: "12px",
              gap: "8px",
              overflowY: "auto",
              overflowX: "hidden",
              flexShrink: 0,
            }}
          >
            {/* New chat button */}
            <button
              onClick={handleNewChat}
              style={{
                width: "100%",
                height: "36px",
                background: "var(--color-accent)",
                border: "none",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                color: "#FFFFFF",
                fontSize: "13px",
                fontWeight: 500,
                flexShrink: 0,
                transition: "background 120ms ease",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "var(--color-accent-hover)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "var(--color-accent)")
              }
            >
              <PlusIcon />
              <span>New chat</span>
            </button>

            {/* Separator below new-chat */}
            <Separator
              style={{
                margin: "4px 0",
                background: "var(--color-border)",
              }}
            />

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

            {/* Conversation list */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                flex: 1,
                overflowY: "auto",
              }}
            >
              {conversations.map((conv) => {
                const isActive = conv.id === activeConvId;
                return (
                  <button
                    key={conv.id}
                    onClick={() => handleSelectConversation(conv.id)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "var(--radius-md)",
                      border: isActive
                        ? "0.5px solid var(--color-accent)"
                        : "none",
                      background: isActive
                        ? "var(--color-accent-subtle)"
                        : "transparent",
                      color: isActive
                        ? "var(--color-accent-text)"
                        : "var(--color-text-secondary)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      textAlign: "left",
                      fontSize: "13px",
                      fontWeight: 500,
                      transition: "all 120ms ease",
                      overflow: "hidden",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = "rgba(15, 23, 42, 0.05)";
                        e.currentTarget.style.color = "var(--color-text-primary)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.color = "var(--color-text-secondary)";
                      }
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
                      style={{ flexShrink: 0, opacity: 0.7 }}
                    >
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                      }}
                    >
                      {conv.title || "Untitled"}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

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
                  background: "#FFFFFF",
                  borderBottom: "0.5px solid var(--color-border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
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

                {/* Right: badges + cancel */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    flexShrink: 0,
                  }}
                >
                  {/* Provider badge */}
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 500,
                      padding: "2px 8px",
                      borderRadius: "var(--radius-pill)",
                      ...getProviderStyle(selectedProvider),
                    }}
                  >
                    {providerLabel}
                  </span>

                  {/* Status badge */}
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 500,
                      padding: "2px 8px",
                      borderRadius: "var(--radius-pill)",
                      ...getStatusStyle(activeConv.status),
                    }}
                  >
                    {activeConv.status}
                  </span>

                  {/* Cancel button — only for active conversations */}
                  {activeConv.status !== "cancelled" && (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={(e) => handleCancel(activeConv.id, e)}
                      style={{
                        fontSize: "12px",
                        color: "var(--color-cancelled-text)",
                        borderColor: "var(--color-cancelled-text)",
                        height: "22px",
                        padding: "0 8px",
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
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
                  maxWidth: "560px",
                  margin: "0 auto",
                  padding: "16px 20px",
                }}
              >
                {/* Empty state */}
                {messages.length === 0 && !streamingContent && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "12px",
                      minHeight: "300px",
                    }}
                  >
                    <ChatBubbleIcon />
                    <span
                      style={{
                        fontSize: "14px",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      Select a conversation or start a new one
                    </span>
                  </div>
                )}

                {/* Message list */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
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
                        <div
                          style={{
                            maxWidth: isUser ? "72%" : "76%",
                            padding: "10px 14px",
                            fontSize: "14px",
                            lineHeight: 1.5,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            /* user:      top-right top-left bottom-right bottom-left */
                            borderRadius: isUser
                              ? "var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg)"
                              : "var(--radius-lg) var(--radius-lg) var(--radius-lg) var(--radius-sm)",
                            background: isUser
                              ? "var(--color-accent)"
                              : "var(--color-card-bg)",
                            color: isUser ? "#FFFFFF" : "var(--color-text-primary)",
                            border: isUser
                              ? "none"
                              : "0.5px solid var(--color-border)",
                          }}
                        >
                          {msg.content}
                        </div>
                      </div>
                    );
                  })}

                  {/* Streaming assistant bubble */}
                  {streaming && (
                    <div style={{ display: "flex", justifyContent: "flex-start" }}>
                      <div
                        style={{
                          maxWidth: "76%",
                          padding: "10px 14px",
                          fontSize: "14px",
                          lineHeight: 1.5,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          borderRadius:
                            "var(--radius-lg) var(--radius-lg) var(--radius-lg) var(--radius-sm)",
                          background: "var(--color-card-bg)",
                          color: "var(--color-text-primary)",
                          border: "0.5px solid var(--color-border)",
                        }}
                      >
                        {streamingContent || (
                          <span
                            style={{
                              color: "var(--color-text-hint)",
                              fontStyle: "italic",
                            }}
                          >
                            Thinking
                          </span>
                        )}
                        <StreamingDots />
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </div>
            </ScrollArea>

            {/* ── INPUT BAR ── */}
            <div
              style={{
                padding: "12px 20px 16px",
                background: "var(--color-page-bg)",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  maxWidth: "560px",
                  margin: "0 auto",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    background: "#FFFFFF",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-pill)",
                    padding: "8px 8px 8px 14px",
                    gap: "0",
                    opacity: streaming ? 0.6 : 1,
                    transition: "opacity 200ms ease",
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
                        <SelectItem key={p.value} value={p.value} className="model-select-item">
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Vertical separator */}
                  <Separator
                    orientation="vertical"
                    style={{
                      height: "18px",
                      margin: "0 10px",
                      background: "var(--color-border)",
                      flexShrink: 0,
                    }}
                  />

                  {/* Text input */}
                  <textarea
                    className="chat-input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isDisabled}
                    placeholder="Ask anything..."
                    rows={1}
                    style={{
                      flex: 1,
                      border: "none",
                      outline: "none",
                      background: "transparent",
                      resize: "none",
                      fontSize: "13px",
                      color: "var(--color-text-primary)",
                      lineHeight: 1.5,
                      maxHeight: "120px",
                      overflowY: "auto",
                      padding: "2px 0",
                      fontFamily: "inherit",
                    }}
                  />

                  {/* Send button */}
                  <button
                    onClick={handleSend}
                    disabled={isDisabled || !input.trim()}
                    style={{
                      background:
                        isDisabled || !input.trim()
                          ? "var(--color-accent-subtle)"
                          : "var(--color-accent)",
                      color:
                        isDisabled || !input.trim()
                          ? "var(--color-accent-text)"
                          : "#FFFFFF",
                      border: "none",
                      borderRadius: "var(--radius-md)",
                      padding: "6px 14px",
                      fontSize: "13px",
                      fontWeight: 500,
                      cursor:
                        isDisabled || !input.trim() ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "4px",
                      transition: "all 120ms ease",
                      flexShrink: 0,
                      minWidth: "52px",
                      height: "28px",
                      marginLeft: "8px",
                    }}
                    onMouseEnter={(e) => {
                      if (!isDisabled && input.trim()) {
                        e.currentTarget.style.background =
                          "var(--color-accent-hover)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isDisabled && input.trim()) {
                        e.currentTarget.style.background = "var(--color-accent)";
                      }
                    }}
                  >
                    {streaming ? <Spinner /> : "Send"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
