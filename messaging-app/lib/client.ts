"use client";

const KEY = "messaging-app:currentUserId";

export function getCurrentUserId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(KEY);
}

export function setCurrentUserId(id: string): void {
  window.localStorage.setItem(KEY, id);
}

export function clearCurrentUserId(): void {
  window.localStorage.removeItem(KEY);
}

export function makeUserId(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
