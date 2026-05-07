"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import Avatar from "@/components/Avatar";
import { clearCurrentUserId, getCurrentUserId } from "@/lib/client";
import type { User } from "@/lib/types";

const AVATAR_CHOICES = ["😀", "😎", "🦊", "🐶", "🐰", "🐧", "🐸", "🦄", "🌸", "🍣"];

export default function ProfilePage() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(AVATAR_CHOICES[0]);
  const [statusMessage, setStatusMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    const id = getCurrentUserId();
    if (!id) {
      router.replace("/");
      return;
    }
    void (async () => {
      const res = await fetch("/api/users");
      const { users } = (await res.json()) as { users: User[] };
      const found = users.find((u) => u.id === id);
      if (!found) {
        clearCurrentUserId();
        router.replace("/");
        return;
      }
      setMe(found);
      setName(found.name);
      setAvatar(found.avatar);
      setStatusMessage(found.statusMessage ?? "");
    })();
  }, [router]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!me || !name.trim()) return;
    setSaving(true);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: me.id,
        name: name.trim(),
        avatar,
        statusMessage: statusMessage.trim(),
        createdAt: me.createdAt,
      }),
    });
    setSaving(false);
    if (res.ok) setSavedAt(Date.now());
  }

  function logout() {
    if (!confirm("ログアウトしますか？(このデバイスからユーザーが切り離されます)")) return;
    clearCurrentUserId();
    router.replace("/");
  }

  if (!me) {
    return (
      <main className="flex min-h-screen items-center justify-center text-gray-400">
        読み込み中...
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col">
      <Header title="プロフィール" back="/chats" />

      <div className="flex flex-col items-center bg-line/10 px-6 py-8">
        <Avatar emoji={avatar} size="lg" />
        <p className="mt-3 text-lg font-semibold text-gray-800">{name || "(名前なし)"}</p>
        {statusMessage && (
          <p className="mt-1 text-xs text-gray-500">{statusMessage}</p>
        )}
      </div>

      <form onSubmit={save} className="space-y-6 px-6 py-6">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">
            アイコン
          </label>
          <div className="grid grid-cols-5 gap-2">
            {AVATAR_CHOICES.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setAvatar(emoji)}
                className={`flex h-12 w-12 items-center justify-center rounded-full text-2xl transition ${
                  avatar === emoji
                    ? "bg-line text-white ring-2 ring-line"
                    : "bg-gray-100 hover:bg-gray-200"
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="name" className="mb-2 block text-sm font-medium text-gray-700">
            名前
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={30}
            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-line focus:outline-none focus:ring-2 focus:ring-line/30"
          />
        </div>

        <div>
          <label htmlFor="status" className="mb-2 block text-sm font-medium text-gray-700">
            ステータスメッセージ
          </label>
          <input
            id="status"
            value={statusMessage}
            onChange={(e) => setStatusMessage(e.target.value)}
            maxLength={50}
            placeholder="例: 元気です"
            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-line focus:outline-none focus:ring-2 focus:ring-line/30"
          />
        </div>

        <div className="flex flex-col gap-3 pt-2">
          <button
            type="submit"
            disabled={!name.trim() || saving}
            className="w-full rounded-lg bg-line py-3 font-semibold text-white shadow transition hover:bg-line-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
          {savedAt && (
            <p className="text-center text-xs text-line">保存しました ✓</p>
          )}
          <button
            type="button"
            onClick={logout}
            className="w-full rounded-lg border border-gray-300 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            ログアウト
          </button>
        </div>
      </form>
    </main>
  );
}
