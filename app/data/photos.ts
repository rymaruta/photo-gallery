// app/data/photos.ts
export type Photo = {
    id: string;
    src: string;
    title: string;
    description?: string;
    category?: string;
    tags?: string[];
    date?: string; // YYYY-MM-DD
    likes?: number;
};

export const RAW_PHOTOS: Photo[] = [
    { id: "1", src: "/images/sample1.jpg", title: "Center of Attention", description: "A lone bloom catching the morning light.", category: "nature", tags: ["nature", "flower"], date: "2024-01-10", likes: 10 },
    { id: "2", src: "/images/sample2.jpg", title: "The Heavens", description: "Clouds over a wide valley at dusk.", category: "landscape", tags: ["landscape"], date: "2023-12-01", likes: 25 },
    { id: "3", src: "/images/sample3.jpg", title: "Dazzling", description: "Sunlight reflecting off a glass facade.", category: "architecture", tags: ["architecture"], date: "2024-02-02", likes: 5 },
    { id: "4", src: "/images/sample4.jpg", title: "Sunlit Blossom", description: "Petals warmed by early sun.", category: "nature", tags: ["nature", "morning"], date: "2024-03-11", likes: 8 },
    { id: "5", src: "/images/sample5.jpg", title: "Twilight at Versailles", description: "A quiet moment in formal gardens.", category: "landscape", tags: ["landscape"], date: "2023-11-20", likes: 18 },
    { id: "6", src: "/images/sample6.jpg", title: "Flare", description: "Lens flare over a coastal cliff.", category: "landscape", tags: ["landscape"], date: "2024-04-02", likes: 30 },
    { id: "7", src: "/images/sample7.jpg", title: "Line Up", description: "Repetitive shadows on a modern facade.", category: "architecture", tags: ["architecture"], date: "2023-10-05", likes: 12 },
];
