import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:5000";

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const res = await fetch(`${BACKEND_URL}/api/conversations/${id}/resume`, {
    method: "PATCH",
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}