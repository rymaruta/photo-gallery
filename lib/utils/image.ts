export async function compressImage(file: File, maxPx = 1920, quality = 0.85): Promise<File> {
    // GIFはアニメーションを保持するため圧縮しない
    if (file.type === "image/gif") return file;

    return new Promise((resolve, reject) => {
        const img = new window.Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            if (width > maxPx || height > maxPx) {
                if (width >= height) { height = Math.round(height * maxPx / width); width = maxPx; }
                else { width = Math.round(width * maxPx / height); height = maxPx; }
            }
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) { resolve(file); return; }

            // JPEG は透過をサポートしないので白背景を敷く
            const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
            if (outputType === "image/jpeg") {
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, width, height);
            }
            ctx.drawImage(img, 0, 0, width, height);

            const ext = outputType === "image/png" ? "png" : "jpg";
            const baseName = file.name.replace(/\.[^.]+$/, "");
            canvas.toBlob(
                (blob) => {
                    if (!blob) { resolve(file); return; }
                    resolve(new File([blob], `${baseName}.${ext}`, { type: outputType }));
                },
                outputType,
                quality,
            );
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("画像の読み込みに失敗しました")); };
        img.src = url;
    });
}
