import { NextResponse } from "next/server";
import { listUsers, upsertUser } from "@/lib/store";
import type { User } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ users: listUsers() });
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<User>;
  if (!body.id || !body.name || !body.avatar) {
    return NextResponse.json({ error: "id, name, avatar required" }, { status: 400 });
  }
  const user: User = {
    id: body.id,
    name: body.name,
    avatar: body.avatar,
    statusMessage: body.statusMessage ?? "",
    createdAt: body.createdAt ?? Date.now(),
  };
  upsertUser(user);
  return NextResponse.json({ user });
}
