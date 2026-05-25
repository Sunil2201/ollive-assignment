"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { Components } from "react-markdown"

const components: Components = {
  // ── Block elements ───────────────────────────────────────────
  p: ({ children }) => (
    <p style={{ margin: "0 0 10px", lineHeight: 1.7 }}>{children}</p>
  ),
  h1: ({ children }) => (
    <h1 style={{ fontSize: "18px", fontWeight: 600, margin: "16px 0 8px", lineHeight: 1.3 }}>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 style={{ fontSize: "16px", fontWeight: 600, margin: "14px 0 6px", lineHeight: 1.3 }}>
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3
      style={{
        fontSize: "14px",
        fontWeight: 600,
        margin: "12px 0 4px",
        lineHeight: 1.4,
        textTransform: "none",
        letterSpacing: 0,
        color: "inherit",
      }}
    >
      {children}
    </h3>
  ),
  ul: ({ children }) => (
    <ul style={{ margin: "0 0 10px", paddingLeft: "20px" }}>{children}</ul>
  ),
  ol: ({ children }) => (
    <ol style={{ margin: "0 0 10px", paddingLeft: "20px" }}>{children}</ol>
  ),
  li: ({ children }) => (
    <li style={{ marginBottom: "4px", lineHeight: 1.6 }}>{children}</li>
  ),
  blockquote: ({ children }) => (
    <blockquote
      style={{
        borderLeft: "3px solid #6366F1",
        margin: "8px 0 10px",
        paddingLeft: "12px",
        color: "#64748B",
        fontStyle: "italic",
      }}
    >
      {children}
    </blockquote>
  ),
  hr: () => (
    <hr style={{ border: "none", borderTop: "1px solid #E2E8F0", margin: "12px 0" }} />
  ),

  // ── Inline elements ──────────────────────────────────────────
  strong: ({ children }) => (
    <strong style={{ fontWeight: 600 }}>{children}</strong>
  ),
  em: ({ children }) => (
    <em style={{ fontStyle: "italic" }}>{children}</em>
  ),
  del: ({ children }) => (
    <del style={{ textDecoration: "line-through", opacity: 0.7 }}>{children}</del>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        color: "#6366F1",
        textDecoration: "underline",
        textUnderlineOffset: "2px",
      }}
    >
      {children}
    </a>
  ),

  // ── Code ─────────────────────────────────────────────────────
  // Inline code: no className; fenced code blocks have a language className
  code: ({ children, className }) => {
    if (className) {
      // Inside a <pre> — let the pre handler style it
      return (
        <code
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "13px",
          }}
        >
          {children}
        </code>
      )
    }
    return (
      <code
        style={{
          background: "#F1F5F9",
          border: "1px solid #E2E8F0",
          borderRadius: "4px",
          padding: "1px 5px",
          fontSize: "13px",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        {children}
      </code>
    )
  },

  pre: ({ children }) => (
    <pre
      style={{
        background: "#0F172A",
        color: "#E2E8F0",
        borderRadius: "8px",
        padding: "14px 16px",
        margin: "8px 0 12px",
        overflowX: "auto",
        fontSize: "13px",
        lineHeight: 1.6,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      {children}
    </pre>
  ),

  // ── Tables (remark-gfm) ──────────────────────────────────────
  table: ({ children }) => (
    <div style={{ overflowX: "auto", margin: "8px 0 12px" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "13px" }}>
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th
      style={{
        padding: "6px 12px",
        borderBottom: "2px solid #E2E8F0",
        textAlign: "left",
        fontWeight: 600,
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td style={{ padding: "6px 12px", borderBottom: "1px solid #F1F3F9" }}>
      {children}
    </td>
  ),
}

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div
      style={{
        minWidth: 0,
        // Remove bottom margin from the last block element so the bubble padding is uniform
      }}
      className="markdown-body"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
