export type Photo = {
    id: string;
    src: string;
    title?: string | Record<string, string>;
    description?: string | Record<string, string[]>;
    category?: string;
    tags?: string[];
    location?: string;
    published?: boolean;
    userId?: string;
    uploadedBy?: string;
    createdAt?: string;
    updatedAt?: string;
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
