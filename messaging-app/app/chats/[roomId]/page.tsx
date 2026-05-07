"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Header from "@/components/Header";
import Avatar from "@/components/Avatar";
import { getCurrentUserId } from "@/lib/client";
import type { Message, User } from "@/lib/types";

export default function ChatRoomPage() {
  const params = useParams<{ roomId: string }>();
  const router = useRouter();
  const roomId = decodeURIComponent(params.roomId);
  const [me, setMe] = useState<User | null>(null);
  const [other, setOther] = useState<User | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(
    async (userId: string) => {
      const res = await fetch(
        `/api/messages?roomId=${encodeURIComponent(roomId)}&userId=${encodeURIComponent(userId)}`,
      );
      if (!res.ok) return;
      const { messages: msgs } = (await res.json()) as { messages: Message[] };
      setMessages(msgs);
    },
    [roomId],
  );

  const loadUsers = useCallback(
    async (userId: string) => {
      const res = await fetch("/api/users");
      const { users } = (await res.json()) as { users: User[] };
      const meUser = users.find((u) => u.id === userId) ?? null;
      setMe(meUser);
      const otherId = roomId.split("__").find((id) => id !== userId);
      const otherUser = users.find((u) => u.id === otherId) ?? null;
      setOther(otherUser);
    },
    [roomId],
  );

  useEffect(() => {
    const id = getCurrentUserId();
    if (!id) {
      router.replace("/");
      return;
    }
    if (!roomId.split("__").includes(id)) {
      router.replace("/chats");
      return;
    }
    void loadUsers(id);
    void loadMessages(id);

    const es = new EventSource("/api/stream");
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "message" && data.message.roomId === roomId) {
          void loadMessages(id);
        } else if (data.type === "user") {
          void loadUsers(id);
        }
      } catch {
        // ignore
      }
    };
    return () => es.close();
  }, [roomId, router, loadMessages, loadUsers]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!me || !text.trim() || sending) return;
    setSending(true);
    const body = { roomId, senderId: me.id, text: text.trim() };
    setText("");
    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSending(false);
    if (!res.ok) {
      alert("送信失敗");
      setText(body.text);
    }
  }

  if (!me || !other) {
    return (
      <main className="flex min-h-screen items-center justify-center text-gray-400">
        読み込み中...
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-line-bg">
      <Header title={other.name} back="/chats" />

      <div
        ref={scrollRef}
        className="scrollbar-thin flex-1 space-y-2 overflow-y-auto px-3 py-4"
      >
        {messages.length === 0 && (
          <div className="mt-8 text-center text-sm text-white/80">
            「{other.name}」とのトークを開始しました
          </div>
        )}
        {messages.map((m, idx) => {
          const mine = m.senderId === me.id;
          const prev = messages[idx - 1];
          const showAvatar = !mine && (!prev || prev.senderId !== m.senderId);
          const isReadByOther = m.readBy.includes(other.id);
          return (
            <div
              key={m.id}
              className={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}
            >
              {!mine && (
                <div className="w-8 shrink-0">
                  {showAvatar && <Avatar emoji={other.avatar} size="sm" />}
                </div>
              )}
              <div
                className={`flex max-w-[75%] flex-col ${mine ? "items-end" : "items-start"}`}
              >
                <div
                  className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm shadow-sm ${
                    mine ? "bg-line text-white" : "bg-white text-gray-800"
                  }`}
                >
                  {m.text}
                </div>
                <div className="mt-1 flex items-center gap-1 text-[10px] text-white/80">
                  {mine && isReadByOther && <span>既読</span>}
                  <span>
                    {new Date(m.createdAt).toLocaleTimeString("ja-JP", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <form
        onSubmit={send}
        className="sticky bottom-0 flex items-end gap-2 border-t bg-white px-3 py-2"
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(e as unknown as React.FormEvent);
            }
          }}
          placeholder="メッセージを入力"
          rows={1}
          className="max-h-32 flex-1 resize-none rounded-2xl border border-gray-300 px-3 py-2 text-sm focus:border-line focus:outline-none focus:ring-2 focus:ring-line/30"
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          className="shrink-0 rounded-full bg-line px-4 py-2 text-sm font-semibold text-white shadow disabled:cursor-not-allowed disabled:opacity-50"
        >
          送信
        </button>
      </form>
    </main>
  );
}
