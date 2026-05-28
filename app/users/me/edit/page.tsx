"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// プロフィール編集は /user/profile に統合
export default function EditProfileRedirect() {
    const router = useRouter();
    useEffect(() => { router.replace("/user/profile"); }, [router]);
    return null;
}
