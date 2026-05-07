import { NextResponse } from "next/server";
import { getOrCreateRoom, getUser, listRoomsFor } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  const rooms = listRoomsFor(userId).map((room) => {
    const otherId = room.memberIds.find((m) => m !== userId)!;
    const other = getUser(otherId);
    return { ...room, other };
  });
  return NextResponse.json({ rooms });
}

export async function POST(req: Request) {
  const { userId, otherUserId } = (await req.json()) as {
    userId?: string;
    otherUserId?: string;
  };
  if (!userId || !otherUserId) {
    return NextResponse.json({ error: "userId and otherUserId required" }, { status: 400 });
  }
  if (userId === otherUserId) {
    return NextResponse.json({ error: "cannot create room with self" }, { status: 400 });
  }
  const room = getOrCreateRoom(userId, otherUserId);
  return NextResponse.json({ room });
}
