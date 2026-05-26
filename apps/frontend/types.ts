export interface Conversation {
  id: string;
  session_id: string;
  title: string;
  status: "active" | "cancelled" | string;
  created_at: string;
  updated_at: string;
  message_count: number;
  primary_provider?: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | string;
  content: string;
  created_at: string;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

/** Per-conversation aggregate metrics (from /api/conversations/metrics) */
export interface ConversationMetric {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  request_count: number;
  total_tokens: number | null;
  avg_latency_ms: number | null;
  max_latency_ms: number | null;
  error_rate: number | null;
  primary_provider: string | null;
  primary_model: string | null;
  first_request_at: string | null;
  last_response_at: string | null;
}

/** Single inference log entry (from /api/conversations/:id/metrics) */
export interface InferenceLogEntry {
  id: string;
  provider: string;
  model: string;
  status: "success" | "error";
  latency_ms: number | null;
  ttft_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  error_code: string | null;
  input_preview: string | null;
  output_preview: string | null;
  request_at: string;
  response_at: string | null;
}
