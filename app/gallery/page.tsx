"use client";

import React from "react";
import Link from "next/link";
import styles from "./gallery.module.css";

export default function GalleryPage() {
    return (
        <main className={`${styles.root} ${styles.container}`}>
            <div className={styles.box}>
                <h1 className={styles.title}>ギャラリー</h1>

                <p className={styles.lead}>
                    ギャラリーの方向性を検討中です。整い次第お知らせします。
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
