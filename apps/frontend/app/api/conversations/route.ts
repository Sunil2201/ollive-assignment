import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:5000";

export async function GET(req: NextRequest) {
  const sessionId = req.headers.get("X-Session-ID") ?? "";

  const res = await fetch(`${BACKEND_URL}/api/conversations`, {
    headers: { "X-Session-ID": sessionId },
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
