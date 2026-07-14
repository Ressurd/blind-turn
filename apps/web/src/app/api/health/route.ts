import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { ok: true, service: "blind-turn-web" },
    { headers: { "cache-control": "no-store" } },
  );
}
