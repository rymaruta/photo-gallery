"use client";

import React from "react";
import Link from "next/link";
import styles from "./gallery.module.css";

export default function GalleryPage() {
    return (
        <main className={`${styles.root} ${styles.container}`}>
            <div className={styles.box}>
                <h1 className={styles.title}>準備中</h1>

                <p className={styles.lead}>
                    ギャラリーの方向性を現在検討しています。整い次第、ここでお知らせします。
                </p>

                <p className={styles.note}>
                    ご不便をおかけしますが、今しばらくお待ちください。
                </p>

                <div className={styles.actions}>
                    <Link href="/" className={styles.link}>
                        戻る
                    </Link>
                </div>
            </div>
        </main>
    );
}
