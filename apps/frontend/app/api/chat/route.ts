import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:5000";

export async function POST(req: NextRequest) {
  const sessionId = req.headers.get("X-Session-ID") ?? "";
  const body = await req.json();

  const res = await fetch(`${BACKEND_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Session-ID": sessionId,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
