export type Photo = {
    id: string;
    src: string;
    title?: string | Record<string, string>;
    description?: string | Record<string, string[]>;
    category?: string;
    tags?: string[];
    location?: string;
    published?: boolean;
    userId?: string; // Cognito sub - 投稿者
    uploadedBy?: string;
    createdAt?: string;
    updatedAt?: string;
    coords?: { lat: number; lng: number }; // 撮影地（約1km精度に丸め済み）
    exif?: {
        camera?: string;
        lens?: string;
        aperture?: string;
        exposure?: string;
        iso?: number;
        focalLength?: string;
        whiteBalance?: string;
        imageSize?: string;
    };
    [key: string]: unknown;
};

export type User = {
    userId: string;       // PK - Cognito sub
    username: string;     // GSI - 一意のhandle (例: ryuhei)
    displayName: string;  // 表示名
    email: string;
    bio?: string;
    avatarKey?: string;   // S3キー (例: avatars/xxx.jpg)
    role?: "admin" | "user";
    createdAt: string;
    updatedAt: string;
};
