export type User = {
  id: string;
  name: string;
  avatar: string; // emoji
  statusMessage?: string;
  createdAt: number;
};

export type Message = {
  id: string;
  roomId: string;
  senderId: string;
  text: string;
  createdAt: number;
  readBy: string[];
};

export type Room = {
  id: string;
  memberIds: [string, string]; // 1-on-1
  lastMessageAt: number;
};

export type StreamEvent =
  | { type: "message"; message: Message }
  | { type: "user"; user: User }
  | { type: "room"; room: Room }
  | { type: "ping" };
