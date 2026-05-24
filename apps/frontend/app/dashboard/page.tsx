"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
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
          </div>
        </main>
      </div>
    </>
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
