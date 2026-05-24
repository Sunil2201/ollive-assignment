import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:5000";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sessionId = req.headers.get("X-Session-ID") ?? "";

  const res = await fetch(`${BACKEND_URL}/api/conversations/${id}`, {
    headers: { "X-Session-ID": sessionId },
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const res = await fetch(`${BACKEND_URL}/api/conversations/${id}`, {
    method: "DELETE",
  });

  if (res.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  const data = await res.json().catch(() => null);
  return NextResponse.json(data, { status: res.status });
}
