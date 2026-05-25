"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { CalendarIcon, ChevronRight, X } from "lucide-react";
import type { DateRange } from "react-day-picker";
import type { ConversationMetric, InferenceLogEntry } from "@/types";
import { fetchConversationMetrics, fetchConversationDetail } from "@/lib/api";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

import { getSessionId } from "@/lib/config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/* ─────────────────────────────────────────────────────────────
   Types
───────────────────────────────────────────────────────────── */
interface MetricsCards {
  total_requests: number;
  avg_latency_ms: number;
  error_rate: number;
  total_tokens: number;
}

interface LatencyPoint {
  hour: string;
  p50: number;
  p95: number;
  p99: number;
}

interface ThroughputPoint {
  hour: string;
  count: number;
}

interface ProviderError {
  provider: string;
  requests: number;
  errors: number;
  error_rate: number;
}

interface MetricsData {
  cards: MetricsCards;
  latency_over_time: LatencyPoint[];
  throughput: ThroughputPoint[];
  errors_by_provider: ProviderError[];
}

/* ─────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────── */
function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Converts a UTC "HH:MM" label returned by the backend into the equivalent
 * local-time string.  We anchor to a fixed epoch date — we only need the
 * UTC→local offset, which is constant across a typical intra-day range.
 */
function utcHourToLocal(hourStr: string): string {
  const [h, m] = hourStr.split(":").map(Number);
  const d = new Date();
  d.setUTCHours(h, m ?? 0, 0, 0);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function getProviderBadgeStyle(provider: string): React.CSSProperties {
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
  return (
    map[provider] ?? {
      backgroundColor: "var(--color-accent-subtle)",
      color: "var(--color-accent-text)",
    }
  );
}

function errorRateColor(rate: number): string {
  if (rate < 2) return "#15803D";
  if (rate <= 5) return "#D97706";
  return "#DC2626";
}

/* ─────────────────────────────────────────────────────────────
   Skeleton for loading state
───────────────────────────────────────────────────────────── */
function Skeleton({ width = "100%", height = 20 }: { width?: string | number; height?: number }) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: "var(--radius-sm)",
        background: "linear-gradient(90deg, #E2E8F0 25%, #F1F5F9 50%, #E2E8F0 75%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.4s infinite",
      }}
    />
  );
}

/* ─────────────────────────────────────────────────────────────
   Metric card config
───────────────────────────────────────────────────────────── */
interface CardConfig {
  label: string;
  value: (c: MetricsCards) => string;
  trend: string;
  trendUp: boolean;
  bg: string;
  border: string;
  textColor: string;
}

const CARD_CONFIGS: CardConfig[] = [
  {
    label: "Total Requests",
    value: (c) => formatNumber(c.total_requests),
    trend: "+12% vs yesterday",
    trendUp: true,
    bg: "#EEF2FF",
    border: "#C7D2FE",
    textColor: "#4338CA",
  },
  {
    label: "Avg Latency",
    value: (c) => `${c.avg_latency_ms.toLocaleString()} ms`,
    trend: "−8% vs yesterday",
    trendUp: true,
    bg: "#F0FDF4",
    border: "#BBF7D0",
    textColor: "#15803D",
  },
  {
    label: "Error Rate",
    value: (c) => `${c.error_rate}%`,
    trend: "+0.3% vs yesterday",
    trendUp: false,
    bg: "#FEF2F2",
    border: "#FECACA",
    textColor: "#DC2626",
  },
  {
    label: "Total Tokens",
    value: (c) => formatNumber(c.total_tokens),
    trend: "+5% vs yesterday",
    trendUp: true,
    bg: "#FFF7ED",
    border: "#FED7AA",
    textColor: "#C2410C",
  },
];

/* ─────────────────────────────────────────────────────────────
   Dashboard page
───────────────────────────────────────────────────────────── */
export default function DashboardPage() {
  /* Date range state — default: last 24 hours */
  const [range, setRange] = useState<DateRange>(() => {
    const to = new Date();
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return { from, to };
  });
  const [calOpen, setCalOpen] = useState(false);

  /* Data state */
  const [data, setData] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  /* Per-conversation metrics state */
  const [convMetrics, setConvMetrics] = useState<ConversationMetric[]>([]);
  const [convLoading, setConvLoading] = useState(true);
  const [convError, setConvError] = useState<string | null>(null);

  /* Drill-down state */
  const [selectedConv, setSelectedConv] = useState<ConversationMetric | null>(null);
  const [logEntries, setLogEntries] = useState<InferenceLogEntry[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  /* Fetch on mount + range change */
  useEffect(() => {
    if (!range.from || !range.to) return;
    setLoading(true);
    setFetchError(null);
    fetch(
      `/api/metrics/summary?from=${range.from.toISOString()}&to=${range.to.toISOString()}`,
      { headers: { "X-Session-ID": getSessionId() } }
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: MetricsData) => {
        setData(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setFetchError(err instanceof Error ? err.message : "Failed to load metrics");
        setLoading(false);
      });
  }, [range]);

  /* Fetch per-conversation metrics when range changes */
  useEffect(() => {
    if (!range.from || !range.to) return;
    setConvLoading(true);
    setConvError(null);
    setSelectedConv(null);
    fetchConversationMetrics(range.from.toISOString(), range.to.toISOString())
      .then((rows) => {
        setConvMetrics(rows);
        setConvLoading(false);
      })
      .catch((err: unknown) => {
        setConvError(err instanceof Error ? err.message : "Failed to load conversation metrics");
        setConvLoading(false);
      });
  }, [range]);

  /* Open drill-down for a conversation */
  const openConvDetail = useCallback((conv: ConversationMetric) => {
    setSelectedConv(conv);
    setLogEntries([]);
    setLogError(null);
    setLogLoading(true);
    fetchConversationDetail(conv.id)
      .then((entries) => {
        setLogEntries(entries);
        setLogLoading(false);
      })
      .catch((err: unknown) => {
        setLogError(err instanceof Error ? err.message : "Failed to load turn details");
        setLogLoading(false);
      });
  }, []);

  const closeConvDetail = useCallback(() => {
    setSelectedConv(null);
    setLogEntries([]);
    setLogError(null);
  }, []);

  /* Date range label */
  const rangeLabel =
    range.from && range.to
      ? `${formatDate(range.from)} – ${formatDate(range.to)}`
      : "Select range";

  return (
    <>
      {/* shimmer keyframe */}
      <style>{`
        @keyframes shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: "100vh",
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

          <Link
            href="/"
            style={{
              fontSize: "13px",
              color: "var(--color-accent)",
              textDecoration: "none",
            }}
          >
            Chat
          </Link>
        </nav>

        {/* ══════════════════════════════════════
            PAGE CONTENT
        ══════════════════════════════════════ */}
        <main
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px 32px",
          }}
        >
          <div style={{ maxWidth: "1200px", margin: "0 auto" }}>

            {/* ── Error banner ── */}
            {fetchError && (
              <div
                style={{
                  marginBottom: "16px",
                  padding: "10px 14px",
                  borderRadius: "var(--radius-md)",
                  background: "#FEF2F2",
                  border: "1px solid #FECACA",
                  color: "#DC2626",
                  fontSize: "13px",
                }}
              >
                Could not load metrics: {fetchError}
              </div>
            )}

            {/* ── Top row: title + date picker ── */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "20px",
              }}
            >
              <h1
                style={{
                  fontSize: "18px",
                  fontWeight: 500,
                  color: "var(--color-text-primary)",
                  margin: 0,
                }}
              >
                Dashboard
              </h1>

              {/* Date range picker */}
              <Popover open={calOpen} onOpenChange={setCalOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      variant="outline"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "7px",
                        fontSize: "13px",
                        height: "34px",
                        paddingLeft: "12px",
                        paddingRight: "12px",
                        borderColor: "var(--color-border)",
                        color: "var(--color-text-primary)",
                        background: "#FFFFFF",
                      }}
                    />
                  }
                >
                  <CalendarIcon size={14} style={{ color: "var(--color-text-secondary)" }} />
                  {rangeLabel}
                </PopoverTrigger>

                <PopoverContent
                  style={{ width: "auto", padding: "8px" }}
                  align="end"
                >
                  <Calendar
                    mode="range"
                    selected={range}
                    onSelect={(r) => {
                      if (r) {
                        setRange(r);
                        if (r.from && r.to) setCalOpen(false);
                      }
                    }}
                    numberOfMonths={2}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* ── Metric cards row ── */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "16px",
                marginBottom: "20px",
              }}
            >
              {CARD_CONFIGS.map((cfg) => (
                <Card
                  key={cfg.label}
                  style={{
                    background: cfg.bg,
                    border: `1px solid ${cfg.border}`,
                    borderRadius: "var(--radius-lg)",
                    boxShadow: "none",
                    padding: 0,
                  }}
                  className="ring-0"
                >
                  <CardContent style={{ padding: "16px 20px" }}>
                    <div
                      style={{
                        fontSize: "12px",
                        fontWeight: 500,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        color: cfg.textColor,
                        marginBottom: "8px",
                      }}
                    >
                      {cfg.label}
                    </div>

                    {loading || !data ? (
                      <Skeleton height={32} width="60%" />
                    ) : (
                      <div
                        style={{
                          fontSize: "28px",
                          fontWeight: 500,
                          color: cfg.textColor,
                          lineHeight: 1,
                          marginBottom: "8px",
                        }}
                      >
                        {cfg.value(data.cards)}
                      </div>
                    )}

                    <div
                      style={{
                        fontSize: "12px",
                        color: cfg.trendUp ? "#15803D" : "#DC2626",
                        display: "flex",
                        alignItems: "center",
                        gap: "3px",
                        marginTop: "6px",
                      }}
                    >
                      <span>{cfg.trendUp ? "↑" : "↓"}</span>
                      <span>{cfg.trend}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* ── Latency chart ── */}
            <Card
              style={{
                background: "#FFFFFF",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-lg)",
                boxShadow: "none",
                marginBottom: "20px",
                padding: 0,
              }}
              className="ring-0"
            >
              <CardContent style={{ padding: "20px 24px" }}>
                <div style={{ marginBottom: "16px" }}>
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "var(--color-text-primary)",
                      marginBottom: "3px",
                    }}
                  >
                    Latency over time
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    p50 / p95 / p99 in milliseconds
                  </div>
                </div>

                {loading || !data ? (
                  <div style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Skeleton height={180} />
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart
                      data={data.latency_over_time}
                      margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F3F9" vertical={false} />
                      <XAxis
                        dataKey="hour"
                        tickFormatter={utcHourToLocal}
                        tick={{ fontSize: 11, fill: "#94A3B8" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "#94A3B8" }}
                        axisLine={false}
                        tickLine={false}
                        width={40}
                      />
                      <Tooltip
                        labelFormatter={(label) => typeof label === "string" ? utcHourToLocal(label) : label}
                        contentStyle={{
                          background: "#FFFFFF",
                          border: "1px solid #E2E8F0",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: "12px", paddingTop: "12px" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="p50"
                        stroke="#818CF8"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="p95"
                        stroke="#F472B6"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="p99"
                        stroke="#FB923C"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* ── Bottom row: throughput + errors table ── */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "16px",
              }}
            >
              {/* Throughput bar chart */}
              <Card
                style={{
                  background: "#FFFFFF",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-lg)",
                  boxShadow: "none",
                  padding: 0,
                }}
                className="ring-0"
              >
                <CardContent style={{ padding: "20px 24px" }}>
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "var(--color-text-primary)",
                      marginBottom: "16px",
                    }}
                  >
                    Requests per hour
                  </div>

                  {loading || !data ? (
                    <div style={{ height: 180, display: "flex", alignItems: "center" }}>
                      <Skeleton height={140} />
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart
                        data={data.throughput}
                        margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#F1F3F9" vertical={false} />
                        <XAxis
                          dataKey="hour"
                          tickFormatter={utcHourToLocal}
                          tick={{ fontSize: 11, fill: "#94A3B8" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: "#94A3B8" }}
                          axisLine={false}
                          tickLine={false}
                          width={36}
                        />
                        <Tooltip
                          labelFormatter={(label) => typeof label === "string" ? utcHourToLocal(label) : label}
                          contentStyle={{
                            background: "#FFFFFF",
                            border: "1px solid #E2E8F0",
                            borderRadius: "8px",
                            fontSize: "12px",
                          }}
                        />
                        <Bar dataKey="count" fill="#6366F1" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              {/* Errors by provider table */}
              <Card
                style={{
                  background: "#FFFFFF",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-lg)",
                  boxShadow: "none",
                  padding: 0,
                }}
                className="ring-0"
              >
                <CardContent style={{ padding: "20px 24px" }}>
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "var(--color-text-primary)",
                      marginBottom: "16px",
                    }}
                  >
                    Errors by provider
                  </div>

                  {loading || !data ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      <Skeleton height={20} />
                      <Skeleton height={20} />
                      <Skeleton height={20} />
                    </div>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          {["Provider", "Requests", "Errors", "Error Rate"].map((h) => (
                            <th
                              key={h}
                              style={{
                                textAlign: "left",
                                fontSize: "11px",
                                fontWeight: 500,
                                textTransform: "uppercase",
                                letterSpacing: "0.04em",
                                color: "var(--color-text-secondary)",
                                padding: "0 8px 10px",
                                borderBottom: "1px solid var(--color-border)",
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.errors_by_provider.map((row) => (
                          <ErrorRow key={row.provider} row={row} />
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            </div>


            {/* ══════════════════════════════════════
                CONVERSATIONS TABLE (Langfuse-style)
            ══════════════════════════════════════ */}
            <div style={{ marginTop: "24px" }}>
              <div
                style={{
                  fontSize: "14px",
                  fontWeight: 500,
                  color: "var(--color-text-primary)",
                  marginBottom: "12px",
                }}
              >
                Conversations
              </div>

              {convError && (
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: "var(--radius-md)",
                    background: "#FEF2F2",
                    border: "1px solid #FECACA",
                    color: "#DC2626",
                    fontSize: "13px",
                    marginBottom: "12px",
                  }}
                >
                  Could not load conversations: {convError}
                </div>
              )}

              {/* Detail panel */}
              {selectedConv && (
                <ConversationDetailPanel
                  conv={selectedConv}
                  entries={logEntries}
                  loading={logLoading}
                  error={logError}
                  onClose={closeConvDetail}
                  getProviderBadgeStyle={getProviderBadgeStyle}
                  errorRateColor={errorRateColor}
                  formatNumber={formatNumber}
                />
              )}

              {!selectedConv && (
                <Card
                  style={{
                    background: "#FFFFFF",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-lg)",
                    boxShadow: "none",
                    padding: 0,
                  }}
                  className="ring-0"
                >
                  <CardContent style={{ padding: 0 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          {["Title", "Provider", "Model", "Turns", "Avg Latency", "Total Tokens", "Error Rate", "Status", "Created"].map((h) => (
                            <th
                              key={h}
                              style={{
                                textAlign: "left",
                                fontSize: "11px",
                                fontWeight: 500,
                                textTransform: "uppercase",
                                letterSpacing: "0.04em",
                                color: "var(--color-text-secondary)",
                                padding: "12px 14px 10px",
                                borderBottom: "1px solid var(--color-border)",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {h}
                            </th>
                          ))}
                          <th style={{ width: 20, borderBottom: "1px solid var(--color-border)" }} />
                        </tr>
                      </thead>
                      <tbody>
                        {convLoading
                          ? Array.from({ length: 4 }).map((_, i) => (
                              <tr key={i}>
                                {Array.from({ length: 10 }).map((__, j) => (
                                  <td key={j} style={{ padding: "12px 14px" }}>
                                    <Skeleton height={14} width={j === 0 ? 160 : 60} />
                                  </td>
                                ))}
                              </tr>
                            ))
                          : convMetrics.length === 0
                          ? (
                            <tr>
                              <td
                                colSpan={10}
                                style={{
                                  padding: "32px 14px",
                                  textAlign: "center",
                                  fontSize: "13px",
                                  color: "var(--color-text-secondary)",
                                }}
                              >
                                No conversations in this date range
                              </td>
                            </tr>
                          )
                          : convMetrics.map((conv) => (
                              <ConversationRow
                                key={conv.id}
                                conv={conv}
                                onClick={() => openConvDetail(conv)}
                                getProviderBadgeStyle={getProviderBadgeStyle}
                                errorRateColor={errorRateColor}
                                formatNumber={formatNumber}
                              />
                            ))
                        }
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              )}
            </div>

          </div>
        </main>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────
   Conversation list row
───────────────────────────────────────────────────────────── */
function ConversationRow({
  conv,
  onClick,
  getProviderBadgeStyle,
  errorRateColor,
  formatNumber,
}: {
  conv: ConversationMetric;
  onClick: () => void;
  getProviderBadgeStyle: (p: string) => React.CSSProperties;
  errorRateColor: (r: number) => string;
  formatNumber: (n: number) => string;
}) {
  const [hovered, setHovered] = useState(false);

  const isActive = conv.status === "active";
  const createdDate = new Date(conv.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <tr
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? "#F8F9FC" : "transparent",
        cursor: "pointer",
        transition: "background 100ms ease",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {/* Title */}
      <td
        style={{
          padding: "11px 14px",
          fontSize: "13px",
          color: "var(--color-text-primary)",
          maxWidth: 220,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontWeight: 500,
        }}
      >
        {conv.title || "Untitled"}
      </td>

      {/* Provider */}
      <td style={{ padding: "11px 14px" }}>
        {conv.primary_provider ? (
          <Badge
            style={{
              ...getProviderBadgeStyle(conv.primary_provider),
              border: "none",
              fontWeight: 500,
              fontSize: "11px",
              textTransform: "capitalize",
            }}
          >
            {conv.primary_provider}
          </Badge>
        ) : (
          <span style={{ color: "var(--color-text-secondary)", fontSize: "13px" }}>—</span>
        )}
      </td>

      {/* Model */}
      <td
        style={{
          padding: "11px 14px",
          fontSize: "12px",
          color: "var(--color-text-secondary)",
          maxWidth: 140,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {conv.primary_model ?? "—"}
      </td>

      {/* Turns */}
      <td style={{ padding: "11px 14px", fontSize: "13px", color: "var(--color-text-primary)" }}>
        {conv.request_count}
      </td>

      {/* Avg latency */}
      <td style={{ padding: "11px 14px", fontSize: "13px", color: "var(--color-text-primary)" }}>
        {conv.avg_latency_ms != null ? `${conv.avg_latency_ms.toLocaleString()} ms` : "—"}
      </td>

      {/* Total tokens */}
      <td style={{ padding: "11px 14px", fontSize: "13px", color: "var(--color-text-primary)" }}>
        {conv.total_tokens != null ? formatNumber(conv.total_tokens) : "—"}
      </td>

      {/* Error rate */}
      <td style={{ padding: "11px 14px" }}>
        {conv.error_rate != null ? (
          <span
            style={{
              fontSize: "13px",
              fontWeight: 500,
              color: errorRateColor(conv.error_rate),
            }}
          >
            {conv.error_rate}%
          </span>
        ) : (
          <span style={{ fontSize: "13px", color: "#15803D", fontWeight: 500 }}>0%</span>
        )}
      </td>

      {/* Status */}
      <td style={{ padding: "11px 14px" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "2px 8px",
            borderRadius: "var(--radius-full, 999px)",
            fontSize: "11px",
            fontWeight: 500,
            background: isActive ? "#F0FDF4" : "#F8FAFC",
            color: isActive ? "#15803D" : "#64748B",
            border: `1px solid ${isActive ? "#BBF7D0" : "#E2E8F0"}`,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: isActive ? "#22C55E" : "#94A3B8",
              flexShrink: 0,
            }}
          />
          {conv.status}
        </span>
      </td>

      {/* Created */}
      <td
        style={{
          padding: "11px 14px",
          fontSize: "12px",
          color: "var(--color-text-secondary)",
          whiteSpace: "nowrap",
        }}
      >
        {createdDate}
      </td>

      {/* Chevron */}
      <td style={{ padding: "11px 10px 11px 0", color: "var(--color-text-secondary)" }}>
        <ChevronRight size={14} />
      </td>
    </tr>
  );
}

/* ─────────────────────────────────────────────────────────────
   Conversation detail panel (Langfuse trace-style)
───────────────────────────────────────────────────────────── */
function ConversationDetailPanel({
  conv,
  entries,
  loading,
  error,
  onClose,
  getProviderBadgeStyle,
  errorRateColor,
  formatNumber,
}: {
  conv: ConversationMetric;
  entries: InferenceLogEntry[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  getProviderBadgeStyle: (p: string) => React.CSSProperties;
  errorRateColor: (r: number) => string;
  formatNumber: (n: number) => string;
}) {
  return (
    <Card
      style={{
        background: "#FFFFFF",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "none",
        padding: 0,
        marginBottom: "0",
      }}
      className="ring-0"
    >
      <CardContent style={{ padding: "20px 24px" }}>
        {/* Header row */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: "16px",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "15px",
                fontWeight: 500,
                color: "var(--color-text-primary)",
                marginBottom: "6px",
              }}
            >
              {conv.title || "Untitled"}
            </div>
            {/* Stats strip */}
            <div
              style={{
                display: "flex",
                gap: "20px",
                flexWrap: "wrap",
              }}
            >
              {[
                { label: "Turns", value: String(conv.request_count) },
                { label: "Avg latency", value: conv.avg_latency_ms != null ? `${conv.avg_latency_ms.toLocaleString()} ms` : "—" },
                { label: "Total tokens", value: conv.total_tokens != null ? formatNumber(conv.total_tokens) : "—" },
                { label: "Error rate", value: conv.error_rate != null ? `${conv.error_rate}%` : "0%" },
                { label: "Provider", value: conv.primary_provider ?? "—" },
                { label: "Model", value: conv.primary_model ?? "—" },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-secondary)", fontWeight: 500 }}>
                    {label}
                  </span>
                  <span style={{ fontSize: "13px", color: "var(--color-text-primary)", fontWeight: 500 }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-border)",
              background: "transparent",
              cursor: "pointer",
              color: "var(--color-text-secondary)",
              flexShrink: 0,
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "var(--color-border)", marginBottom: "16px" }} />

        {/* Turns section label */}
        <div
          style={{
            fontSize: "12px",
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: "var(--color-text-secondary)",
            marginBottom: "10px",
          }}
        >
          Turns
        </div>

        {error && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: "var(--radius-md)",
              background: "#FEF2F2",
              border: "1px solid #FECACA",
              color: "#DC2626",
              fontSize: "13px",
              marginBottom: "12px",
            }}
          >
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} height={36} />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", padding: "16px 0" }}>
            No inference logs recorded for this conversation.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["#", "Provider", "Model", "Latency", "Prompt Tokens", "Completion Tokens", "Total Tokens", "Status", "Input Preview"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      fontSize: "11px",
                      fontWeight: 500,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: "var(--color-text-secondary)",
                      padding: "0 10px 8px",
                      borderBottom: "1px solid var(--color-border)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, idx) => (
                <TurnRow
                  key={entry.id}
                  entry={entry}
                  turnNumber={idx + 1}
                  getProviderBadgeStyle={getProviderBadgeStyle}
                  errorRateColor={errorRateColor}
                />
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────
   Single turn row inside the detail panel
───────────────────────────────────────────────────────────── */
function TurnRow({
  entry,
  turnNumber,
  getProviderBadgeStyle,
  errorRateColor: _errorRateColor,
}: {
  entry: InferenceLogEntry;
  turnNumber: number;
  getProviderBadgeStyle: (p: string) => React.CSSProperties;
  errorRateColor: (r: number) => string;
}) {
  const [hovered, setHovered] = useState(false);
  const isError = entry.status === "error";

  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? "#F8F9FC" : isError ? "#FFF8F8" : "transparent",
        transition: "background 100ms ease",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {/* Turn # */}
      <td style={{ padding: "9px 10px", fontSize: "12px", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
        {turnNumber}
      </td>

      {/* Provider */}
      <td style={{ padding: "9px 10px" }}>
        <Badge
          style={{
            ...getProviderBadgeStyle(entry.provider),
            border: "none",
            fontWeight: 500,
            fontSize: "11px",
            textTransform: "capitalize",
          }}
        >
          {entry.provider}
        </Badge>
      </td>

      {/* Model */}
      <td style={{ padding: "9px 10px", fontSize: "12px", color: "var(--color-text-secondary)", whiteSpace: "nowrap", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}>
        {entry.model}
      </td>

      {/* Latency */}
      <td style={{ padding: "9px 10px", fontSize: "13px", color: "var(--color-text-primary)", whiteSpace: "nowrap" }}>
        {entry.latency_ms != null ? `${entry.latency_ms.toLocaleString()} ms` : "—"}
      </td>

      {/* Prompt tokens */}
      <td style={{ padding: "9px 10px", fontSize: "13px", color: "var(--color-text-primary)" }}>
        {entry.prompt_tokens?.toLocaleString() ?? "—"}
      </td>

      {/* Completion tokens */}
      <td style={{ padding: "9px 10px", fontSize: "13px", color: "var(--color-text-primary)" }}>
        {entry.completion_tokens?.toLocaleString() ?? "—"}
      </td>

      {/* Total tokens */}
      <td style={{ padding: "9px 10px", fontSize: "13px", color: "var(--color-text-primary)", fontWeight: 500 }}>
        {entry.total_tokens?.toLocaleString() ?? "—"}
      </td>

      {/* Status */}
      <td style={{ padding: "9px 10px" }}>
        <span
          style={{
            display: "inline-block",
            padding: "2px 8px",
            borderRadius: "var(--radius-full, 999px)",
            fontSize: "11px",
            fontWeight: 500,
            background: isError ? "#FEF2F2" : "#F0FDF4",
            color: isError ? "#DC2626" : "#15803D",
            border: `1px solid ${isError ? "#FECACA" : "#BBF7D0"}`,
          }}
        >
          {isError ? (entry.error_code ?? "error") : "success"}
        </span>
      </td>

      {/* Input preview */}
      <td
        style={{
          padding: "9px 10px",
          fontSize: "12px",
          color: "var(--color-text-secondary)",
          maxWidth: 260,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={entry.input_preview ?? undefined}
      >
        {entry.input_preview ?? "—"}
      </td>
    </tr>
  );
}

/* ─────────────────────────────────────────────────────────────
   Error table row (separate component for hover state)
───────────────────────────────────────────────────────────── */
function ErrorRow({ row }: { row: ProviderError }) {
  const [hovered, setHovered] = useState(false);

  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? "#F8F9FC" : "transparent",
        transition: "background 100ms ease",
      }}
    >
      <td style={{ padding: "10px 8px" }}>
        <Badge
          style={{
            ...getProviderBadgeStyle(row.provider),
            border: "none",
            fontWeight: 500,
            fontSize: "11px",
            textTransform: "capitalize",
          }}
        >
          {row.provider}
        </Badge>
      </td>
      <td
        style={{
          padding: "10px 8px",
          fontSize: "13px",
          color: "var(--color-text-primary)",
        }}
      >
        {row.requests.toLocaleString()}
      </td>
      <td
        style={{
          padding: "10px 8px",
          fontSize: "13px",
          color: "var(--color-text-primary)",
        }}
      >
        {row.errors}
      </td>
      <td style={{ padding: "10px 8px" }}>
        <span
          style={{
            fontSize: "13px",
            fontWeight: 500,
            color: errorRateColor(row.error_rate),
          }}
        >
          {row.error_rate}%
        </span>
      </td>
    </tr>
  );
}
