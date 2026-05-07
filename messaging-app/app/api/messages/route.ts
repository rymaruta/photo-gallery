import { NextResponse } from "next/server";
import { addMessage, getRoom, listMessages, markRead } from "@/lib/store";
import type { Message } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const roomId = url.searchParams.get("roomId");
  const userId = url.searchParams.get("userId");
  if (!roomId) return NextResponse.json({ error: "roomId required" }, { status: 400 });
  if (userId) markRead(roomId, userId);
  return NextResponse.json({ messages: listMessages(roomId) });
}

export async function POST(req: Request) {
  const { roomId, senderId, text } = (await req.json()) as {
    roomId?: string;
    senderId?: string;
    text?: string;
  };
  if (!roomId || !senderId || !text?.trim()) {
    return NextResponse.json({ error: "roomId, senderId, text required" }, { status: 400 });
  }
  const room = getRoom(roomId);
  if (!room) return NextResponse.json({ error: "room not found" }, { status: 404 });
  if (!room.memberIds.includes(senderId)) {
    return NextResponse.json({ error: "not a member of room" }, { status: 403 });
  }
  const message: Message = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    roomId,
    senderId,
    text: text.trim().slice(0, 2000),
    createdAt: Date.now(),
    readBy: [senderId],
  };
  addMessage(message);
  maybeAutoReply(message);
  return NextResponse.json({ message });
}

function maybeAutoReply(incoming: Message) {
  const room = getRoom(incoming.roomId);
  if (!room) return;
  const other = room.memberIds.find((m) => m !== incoming.senderId);
  if (!other || !other.startsWith("bot-")) return;
  const replies: Record<string, string[]> = {
    "bot-kuma": ["がおー🐻", "はちみつちょうだい", "なるほどね"],
    "bot-neko": ["にゃん🐱", "ふみふみ…", "ごろごろ"],
    "bot-panda": ["笹が食べたい🐼", "ねむい…", "了解です"],
  };
  const pool = replies[other] ?? ["..."];
  const text = pool[Math.floor(Math.random() * pool.length)];
  setTimeout(() => {
    addMessage({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      roomId: incoming.roomId,
      senderId: other,
      text,
      createdAt: Date.now(),
      readBy: [other],
    });
  }, 700 + Math.random() * 1200);
}
