"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import Avatar from "@/components/Avatar";
import { getCurrentUserId } from "@/lib/client";
import type { Room, User } from "@/lib/types";

type RoomWithOther = Room & { other?: User };

export default function ChatsPage() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  const [rooms, setRooms] = useState<RoomWithOther[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tab, setTab] = useState<"chats" | "friends">("chats");

  const refresh = useCallback(async (userId: string) => {
    const [usersRes, roomsRes] = await Promise.all([
      fetch("/api/users").then((r) => r.json()),
      fetch(`/api/rooms?userId=${encodeURIComponent(userId)}`).then((r) => r.json()),
    ]);
    setUsers(usersRes.users ?? []);
    setRooms(roomsRes.rooms ?? []);
    const found = (usersRes.users as User[]).find((u) => u.id === userId);
    if (found) setMe(found);
  }, []);

  useEffect(() => {
    const id = getCurrentUserId();
    if (!id) {
      router.replace("/");
      return;
    }
    void refresh(id);

    const es = new EventSource("/api/stream");
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "message" || data.type === "user" || data.type === "room") {
          void refresh(id);
        }
      } catch {
        // ignore
      }
    };
    return () => es.close();
  }, [refresh, router]);

  async function startChat(otherUserId: string) {
    if (!me) return;
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: me.id, otherUserId }),
    });
    if (!res.ok) return;
    const { room } = (await res.json()) as { room: Room };
    router.push(`/chats/${encodeURIComponent(room.id)}`);
  }

  if (!me) {
    return (
      <main className="flex min-h-screen items-center justify-center text-gray-400">
        読み込み中...
      </main>
    );
  }

  const otherUsers = users.filter((u) => u.id !== me.id);

  return (
    <main className="flex min-h-screen flex-col">
      <Header
        title={tab === "chats" ? "トーク" : "友だち"}
        right={
          <Link href="/profile" aria-label="プロフィール" className="text-xl">
            ⚙
          </Link>
        }
      />

      <div className="flex border-b bg-white">
        <button
          onClick={() => setTab("chats")}
          className={`flex-1 py-3 text-sm font-medium ${
            tab === "chats" ? "border-b-2 border-line text-line" : "text-gray-500"
          }`}
        >
          トーク ({rooms.length})
        </button>
        <button
          onClick={() => setTab("friends")}
          className={`flex-1 py-3 text-sm font-medium ${
            tab === "friends" ? "border-b-2 border-line text-line" : "text-gray-500"
          }`}
        >
          友だち ({otherUsers.length})
        </button>
      </div>

      {tab === "chats" ? (
        <ul className="flex-1 divide-y bg-white">
          {rooms.length === 0 && (
            <li className="px-6 py-12 text-center text-sm text-gray-400">
              まだトークがありません。<br />
              「友だち」タブから話しかけてみよう。
            </li>
          )}
          {rooms.map((room) => (
            <li key={room.id}>
              <Link
                href={`/chats/${encodeURIComponent(room.id)}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50"
              >
                <Avatar emoji={room.other?.avatar ?? "👤"} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-gray-800">
                    {room.other?.name ?? "Unknown"}
                  </div>
                  <div className="truncate text-xs text-gray-500">
                    {new Date(room.lastMessageAt).toLocaleString("ja-JP", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex-1 divide-y bg-white">
          {otherUsers.length === 0 && (
            <li className="px-6 py-12 text-center text-sm text-gray-400">
              友だちがいません
            </li>
          )}
          {otherUsers.map((u) => (
            <li key={u.id}>
              <button
                onClick={() => startChat(u.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
              >
                <Avatar emoji={u.avatar} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-gray-800">
                    {u.name}
                  </div>
                  {u.statusMessage && (
                    <div className="truncate text-xs text-gray-500">
                      {u.statusMessage}
                    </div>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
