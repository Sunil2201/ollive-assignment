export interface Conversation {
  id: string;
  session_id: string;
  title: string;
  status: "active" | "cancelled" | string;
  created_at: string;
  updated_at: string;
  message_count: number;
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
