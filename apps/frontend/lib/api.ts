import { getSessionId } from "@/lib/config";
import type { Conversation, ConversationWithMessages, Message } from "@/types";

interface SendMessagePayload {
  messages: { role: string; content: string }[];
  conversationId: string;
  provider: string;
}

interface StreamMessagePayload {
  messages: { role: string; content: string }[];
  conversationId: string;
  provider: string;
  isResume?: boolean;
}

// Shape the backend /api/chat endpoint actually returns
interface ChatApiResponse {
  content: string;
  conversationId: string;
  messageId: string;
}

interface SendMessageResponse {
  message: Message;
  conversationId: string;
}

export async function streamMessage(
  payload: StreamMessagePayload,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (error: string) => void,
  onAbort: () => void,
  signal?: AbortSignal
): Promise<void> {
  const sessionId = getSessionId();

  let res: Response;
  try {
    res = await fetch("/api/chat/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-ID": sessionId,
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      onAbort();
      return;
    }
    onError(err instanceof Error ? err.message : "Network error");
    return;
  }

  if (!res.ok || !res.body) {
    onError(`Stream request failed: ${res.status}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process all complete lines from the buffer
      const lines = buffer.split("\n");
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice("data: ".length).trim();
        if (!jsonStr) continue;

        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.chunk !== undefined) {
            onChunk(parsed.chunk);
          } else if (parsed.done) {
            onDone();
            return;
          } else if (parsed.error) {
            onError(parsed.error);
            return;
          }
        } catch {
          // ignore malformed lines
        }
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      onAbort();
    } else {
      onError(err instanceof Error ? err.message : "Stream read error");
    }
  }
}

export async function listConversations(): Promise<Conversation[]> {
  const sessionId = getSessionId();
  const res = await fetch("/api/conversations", {
    headers: { "X-Session-ID": sessionId },
  });
  if (!res.ok) throw new Error(`Failed to list conversations: ${res.status}`);
  return res.json();
}

export async function getConversation(
  id: string
): Promise<ConversationWithMessages> {
  const sessionId = getSessionId();
  const res = await fetch(`/api/conversations/${id}`, {
    headers: { "X-Session-ID": sessionId },
  });
  if (!res.ok) throw new Error(`Failed to get conversation: ${res.status}`);
  return res.json();
}

export async function cancelConversation(id: string): Promise<Conversation> {
  const res = await fetch(`/api/conversations/${id}/cancel`, {
    method: "PATCH",
  });
  if (!res.ok) throw new Error(`Failed to cancel conversation: ${res.status}`);
  return res.json();
}

export async function stopConversation(
  id: string,
  partialContent: string
): Promise<Conversation> {
  const res = await fetch(`/api/conversations/${id}/stop`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ partial_content: partialContent }),
  });
  if (!res.ok) throw new Error(`Failed to stop conversation: ${res.status}`);
  return res.json();
}

export async function resumeConversation(id: string): Promise<Conversation> {
  const res = await fetch(`/api/conversations/${id}/resume`, {
    method: "PATCH",
  });
  if (!res.ok) throw new Error(`Failed to resume conversation: ${res.status}`);
  return res.json();
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`/api/conversations/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete conversation: ${res.status}`);
}

export async function sendMessage(
  payload: SendMessagePayload
): Promise<SendMessageResponse> {
  const sessionId = getSessionId();
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Session-ID": sessionId,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Failed to send message: ${res.status}`);

  // Backend returns { content, conversationId, messageId } — normalise into a Message
  const raw: ChatApiResponse = await res.json();
  const message: Message = {
    id: raw.messageId,
    conversation_id: raw.conversationId,
    role: "assistant",
    content: raw.content,
    created_at: new Date().toISOString(),
  };
  return { message, conversationId: raw.conversationId };
}
