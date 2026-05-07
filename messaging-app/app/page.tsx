"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUserId, makeUserId, setCurrentUserId } from "@/lib/client";

const AVATAR_CHOICES = ["😀", "😎", "🦊", "🐶", "🐰", "🐧", "🐸", "🦄", "🌸", "🍣"];

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(AVATAR_CHOICES[0]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const id = getCurrentUserId();
    if (id) router.replace("/chats");
  }, [router]);

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    const id = makeUserId();
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name: name.trim(), avatar, statusMessage: "" }),
    });
    if (!res.ok) {
      setSubmitting(false);
      alert("登録に失敗しました");
      return;
    }
    setCurrentUserId(id);
    router.replace("/chats");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-10">
      <div className="mb-8 text-center">
        <div className="mb-2 text-5xl">💬</div>
        <h1 className="text-2xl font-bold text-gray-800">Talk</h1>
        <p className="mt-1 text-sm text-gray-500">かんたんメッセージング</p>
      </div>

      <form onSubmit={handleStart} className="w-full space-y-6">
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
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={30}
            placeholder="例: たろう"
            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-line focus:outline-none focus:ring-2 focus:ring-line/30"
          />
        </div>

        <button
          type="submit"
          disabled={!name.trim() || submitting}
          className="w-full rounded-lg bg-line py-3 font-semibold text-white shadow transition hover:bg-line-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "登録中..." : "はじめる"}
        </button>
      </form>
    </main>
  );
}
