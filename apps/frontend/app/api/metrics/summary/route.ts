import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:5000";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const sessionId = req.headers.get("X-Session-ID") ?? "";

  const params = new URLSearchParams();
  if (searchParams.get("from")) params.set("from", searchParams.get("from")!);
  if (searchParams.get("to"))   params.set("to",   searchParams.get("to")!);

  const query = params.size > 0 ? `?${params.toString()}` : "";

  try {
    const res = await fetch(`${BACKEND_URL}/api/metrics/summary${query}`, {
      headers: { "X-Session-ID": sessionId },
      cache: "no-store",
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "failed to reach metrics backend" },
      { status: 502 }
    );
  }
}
