"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "../auth/context";
import { useLocale } from "../i18n/context";
import { useToast } from "../../lib/hooks/useToast";
import { PencilIcon, TrashIcon, PlusIcon } from "@heroicons/react/24/outline";
import type { Photo } from "../data/photos";
import DeleteConfirmModal from "../components/DeleteConfirmModal";
import { log } from "../../lib/utils/log";
import { ROUTES } from "../../lib/routes";

export default function AdminPage() {
    const { isAuthenticated, isAdminUser, loading } = useAuth();
    const router = useRouter();
    const { locale } = useLocale();
    const { showToast } = useToast();
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [loadingPhotos, setLoadingPhotos] = useState(true);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [photoToDelete, setPhotoToDelete] = useState<Photo | null>(null);
    const isMountedRef = useRef(true);

    useEffect(() => {
        isMountedRef.current = true;
        return () => { isMountedRef.current = false; };
    }, []);

    // 認証チェック
    useEffect(() => {
        if (!loading) {
            if (!isAuthenticated) {
                router.push("/admin/login");
            } else if (!isAdminUser) {
                router.push("/");
            }
        }
    }, [isAuthenticated, isAdminUser, loading, router]);

    // 写真一覧を取得
    useEffect(() => {
        if (isAuthenticated && isAdminUser) {
            void loadPhotos();
        }
    }, [isAuthenticated, isAdminUser]); // eslint-disable-line react-hooks/exhaustive-deps

    const loadPhotos = useCallback(async () => {
        try {
            setLoadingPhotos(true);
            // 管理者ページでは常に最新データを取得するためキャッシュを無効化
            const { publicFetch } = await import("../../lib/utils/api");
            const response = await publicFetch("/photos", {
                cache: "no-store",
            });
            if (response.ok) {
                const data = await response.json();
                // 最近更新した順にソート（updatedAt > createdAt > その他）
                const sortedPhotos = [...data].sort((a, b) => {
                    const aDate = a.updatedAt || a.createdAt;
                    const bDate = b.updatedAt || b.createdAt;
                    
                    // 日付がない場合は最後に配置
                    if (!aDate && !bDate) return 0;
                    if (!aDate) return 1;
                    if (!bDate) return -1;
                    
                    // 新しい順（降順）
                    return new Date(bDate).getTime() - new Date(aDate).getTime();
                });
                setPhotos(sortedPhotos);
            } else {
                // 取得失敗のトーストは出さない（静かに失敗させる）
                log.error("写真の取得に失敗しました", {
                    status: response.status,
                    statusText: response.statusText,
                });
            }
        } catch (error) {
            log.error("写真取得エラー:", error);
        } finally {
            if (isMountedRef.current) setLoadingPhotos(false);
        }
    }, []);

    const handleDeleteClick = (photo: Photo) => {
        setPhotoToDelete(photo);
        setDeleteModalOpen(true);
    };

    const handleDeleteConfirm = async () => {
        if (!photoToDelete) return;

            try {
                setDeletingId(photoToDelete.id);

                log.info("削除開始:", {
                    photoId: photoToDelete.id,
                    photoSrc: photoToDelete.src,
                });

                const { authenticatedFetch } = await import("../../lib/utils/api");
                const response = await authenticatedFetch(`/photos/${photoToDelete.id}`, {
                    method: "DELETE",
                });

            if (response.ok) {
                const result = await response.json().catch(() => ({}));
                log.info("削除成功:", result);
                
                showToast(
                    locale === "en" ? "Photo deleted successfully." : "写真を削除しました。",
                    "success"
                );
                setDeleteModalOpen(false);
                setPhotoToDelete(null);
                
                // 削除された写真をローカル状態からも削除（即座に反映）
                setPhotos((prevPhotos) => prevPhotos.filter((p) => p.id !== photoToDelete.id));
                
                // サーバー側のキャッシュ更新を待ってから再読み込み
                setTimeout(() => {
                    if (isMountedRef.current) void loadPhotos();
                }, 500);
            } else {
                const errorText = await response.text().catch(() => "Unknown error");
                let errorMessage = "Unknown error";
                
                try {
                    const errorJson = JSON.parse(errorText);
                    errorMessage = errorJson.error || errorText;
                } catch {
                    errorMessage = errorText || `HTTP ${response.status}: ${response.statusText}`;
                }

                log.error("削除APIエラー:", {
                    status: response.status,
                    statusText: response.statusText,
                    error: errorMessage,
                });

                showToast(
                    errorMessage || (locale === "en" ? "Failed to delete photo" : "削除に失敗しました"),
                    "error"
                );
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            log.error("削除エラー:", {
                error: errorMessage,
                stack: errorStack,
                photoId: photoToDelete?.id,
            });
            showToast(
                locale === "en" 
                    ? `Failed to delete photo: ${errorMessage || "Unknown error"}` 
                    : `削除に失敗しました: ${errorMessage || "不明なエラー"}`,
                "error"
            );
        } finally {
            setDeletingId(null);
            setDeleteModalOpen(false);
            setPhotoToDelete(null);
        }
    };

    const handleDeleteCancel = () => {
        setDeleteModalOpen(false);
        setPhotoToDelete(null);
    };

    // ローディング中または認証されていない場合
    if (loading || !isAuthenticated || !isAdminUser) {
        return (
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-7xl mx-auto w-full flex items-center justify-center">
                <div className="w-12 h-12 border-3 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        );
    }

    const getTitle = (photo: Photo): string => {
        // タイトルが文字列の場合
        if (typeof photo.title === "string" && photo.title.trim()) {
            return photo.title;
        }
        
        // タイトルがオブジェクトの場合
        if (photo.title && typeof photo.title === "object") {
            const title = photo.title[locale] || photo.title.ja || photo.title.en;
            if (title && title.trim()) {
                return title;
            }
        }
        
        // タイトルが存在しない、または空の場合、他の情報から代替タイトルを生成
        const fallbacks: string[] = [];
        if (photo.location) fallbacks.push(photo.location);
        if (photo.category) fallbacks.push(photo.category);
        if (photo.id) fallbacks.push(`ID: ${photo.id}`);
        
        if (fallbacks.length > 0) {
            return fallbacks.join(" - ");
        }
        
        // それでも何もない場合は「無題」
        return locale === "en" ? "Untitled" : "無題";
    };

    return (
        <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-7xl mx-auto w-full">
            <div className="mb-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
                    <h1 className="text-2xl sm:text-3xl font-bold">
                        {locale === "en" ? "Photo Management" : "写真管理"}
                    </h1>
                    <Link
                        href={ROUTES.UPLOAD}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-white text-black rounded-md font-medium hover:bg-white/90 transition-colors"
                    >
                        <PlusIcon className="w-5 h-5" />
                        <span>{locale === "en" ? "Upload New Photo" : "新しい写真をアップロード"}</span>
                    </Link>
                </div>
            </div>

            {loadingPhotos ? (
                <div className="flex items-center justify-center py-12">
                    <div className="w-12 h-12 border-3 border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
            ) : photos.length === 0 ? (
                <div className="text-center py-12 text-white/60">
                    <p>{locale === "en" ? "No photos found." : "写真がありません。"}</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {photos.map((photo) => (
                        <div
                            key={photo.id}
                            className="bg-white/5 border border-white/10 rounded-lg overflow-hidden hover:border-white/20 transition-colors"
                        >
                            <div className="relative aspect-square bg-black">
                                <Image
                                    src={photo.src}
                                    alt={getTitle(photo)}
                                    fill
                                    className="object-cover"
                                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                                    loading="lazy"
                                />
                            </div>
                            <div className="p-4">
                                <h3 className="font-medium mb-2 line-clamp-2">{getTitle(photo)}</h3>
                                <div className="flex items-center gap-2 text-sm text-white/60 mb-3">
                                    {photo.category && (
                                        <span className="px-2 py-1 bg-white/10 rounded text-xs">
                                            {photo.category}
                                        </span>
                                    )}
                                    {photo.location && (
                                        <span className="text-xs truncate">{photo.location}</span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <Link
                                        href={`/admin/edit?id=${photo.id}`}
                                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-md transition-colors text-sm"
                                    >
                                        <PencilIcon className="w-4 h-4" />
                                        <span>{locale === "en" ? "Edit" : "編集"}</span>
                                    </Link>
                                    <button
                                        onClick={() => handleDeleteClick(photo)}
                                        disabled={deletingId === photo.id}
                                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-md transition-colors text-sm text-white/70 hover:text-white/90 disabled:opacity-50"
                                    >
                                        <TrashIcon className="w-4 h-4" />
                                        <span>{locale === "en" ? "Delete" : "削除"}</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* 削除確認モーダル */}
            <DeleteConfirmModal
                photo={photoToDelete}
                isOpen={deleteModalOpen}
                onClose={handleDeleteCancel}
                onConfirm={handleDeleteConfirm}
                locale={locale}
                deleting={deletingId !== null}
            />
        </main>
    );
}
