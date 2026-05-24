import { NextRequest } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:5000";

export async function POST(req: NextRequest) {
  const sessionId = req.headers.get("X-Session-ID") ?? "";
  const body = await req.json();

  const res = await fetch(`${BACKEND_URL}/api/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Session-ID": sessionId,
    },
    body: JSON.stringify(body),
  });

  // Stream the SSE response straight through to the client
  return new Response(res.body, {
    status: res.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
