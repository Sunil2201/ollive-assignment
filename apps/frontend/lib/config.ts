/**
 * Returns a stable session ID stored in localStorage.
 * This is a client-side-only utility.
 */
export function getSessionId(): string {
  const key = "llm_session_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}
