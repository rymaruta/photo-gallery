import { EventEmitter } from "node:events";
import type { Message, Room, StreamEvent, User } from "./types";

type Store = {
  users: Map<string, User>;
  rooms: Map<string, Room>;
  messages: Map<string, Message[]>; // roomId -> messages
  emitter: EventEmitter;
};

declare global {
  // eslint-disable-next-line no-var
  var __messagingStore: Store | undefined;
}

function createStore(): Store {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  return {
    users: new Map(),
    rooms: new Map(),
    messages: new Map(),
    emitter,
  };
}

const store: Store = globalThis.__messagingStore ?? createStore();
if (!globalThis.__messagingStore) {
  globalThis.__messagingStore = store;
  seedDemoUsers(store);
}

function seedDemoUsers(s: Store) {
  const demoUsers: User[] = [
    {
      id: "bot-kuma",
      name: "クマ太郎",
      avatar: "🐻",
      statusMessage: "はちみつ食べたい",
      createdAt: Date.now(),
    },
    {
      id: "bot-neko",
      name: "ねこさん",
      avatar: "🐱",
      statusMessage: "ごろごろ中",
      createdAt: Date.now(),
    },
    {
      id: "bot-panda",
      name: "ぱんだ",
      avatar: "🐼",
      statusMessage: "笹うまい",
      createdAt: Date.now(),
    },
  ];
  for (const u of demoUsers) s.users.set(u.id, u);
}

export function listUsers(): User[] {
  return Array.from(store.users.values()).sort((a, b) => a.createdAt - b.createdAt);
}

export function getUser(id: string): User | undefined {
  return store.users.get(id);
}

export function upsertUser(user: User): User {
  store.users.set(user.id, user);
  emit({ type: "user", user });
  return user;
}

export function listRoomsFor(userId: string): Room[] {
  return Array.from(store.rooms.values())
    .filter((r) => r.memberIds.includes(userId))
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

export function getRoom(id: string): Room | undefined {
  return store.rooms.get(id);
}

function roomKey(a: string, b: string): string {
  return [a, b].sort().join("__");
}

export function getOrCreateRoom(a: string, b: string): Room {
  const id = roomKey(a, b);
  let room = store.rooms.get(id);
  if (!room) {
    room = {
      id,
      memberIds: [a, b].sort() as [string, string],
      lastMessageAt: Date.now(),
    };
    store.rooms.set(id, room);
    emit({ type: "room", room });
  }
  return room;
}

export function listMessages(roomId: string): Message[] {
  return store.messages.get(roomId) ?? [];
}

export function addMessage(msg: Message): Message {
  const list = store.messages.get(msg.roomId) ?? [];
  list.push(msg);
  store.messages.set(msg.roomId, list);
  const room = store.rooms.get(msg.roomId);
  if (room) {
    room.lastMessageAt = msg.createdAt;
    store.rooms.set(room.id, room);
    emit({ type: "room", room });
  }
  emit({ type: "message", message: msg });
  return msg;
}

export function markRead(roomId: string, userId: string): void {
  const list = store.messages.get(roomId);
  if (!list) return;
  let changed = false;
  for (const m of list) {
    if (m.senderId !== userId && !m.readBy.includes(userId)) {
      m.readBy.push(userId);
      changed = true;
      emit({ type: "message", message: m });
    }
  }
  if (changed) store.messages.set(roomId, list);
}

export function subscribe(listener: (e: StreamEvent) => void): () => void {
  store.emitter.on("event", listener);
  return () => store.emitter.off("event", listener);
}

function emit(e: StreamEvent) {
  store.emitter.emit("event", e);
}
