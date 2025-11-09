// app/about/page.tsx
import React from "react";
import Image from "next/image";

export default function AboutPage() {
    return (
        <div className="min-h-screen bg-[#060606] text-white">
            <div className="mx-auto max-w-screen-lg p-6 md:p-12">
                <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
                    {/* 左: アイコン風プロフィール写真 */}
                    <div className="flex-shrink-0">
                        <div className="w-20 h-20 md:w-36 md:h-36 rounded-sm overflow-hidden bg-gray-900">
                            <img
                                src="/avatar.jpg"
                                alt="Ryuhei Maruta"
                                className="w-full h-full object-cover"
                            />
                        </div>
                    </div>

                    {/* 右: 名前・肩書き */}
                    <div className="flex-1">
                        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">丸田 竜平</h1>
                        <p className="mt-1 text-sm md:text-base text-gray-300">
                            Photographer — quiet, observant, intentional
                        </p>

                        {/* SNS */}
                        <div className="mt-4 flex items-center gap-3">
                            <a href="https://www.instagram.com/your_handle" target="_blank" rel="noopener noreferrer" className="w-9 h-9 md:w-12 md:h-12 rounded-full flex items-center justify-center hover:bg-white/6 transition-colors">
                                <img src="/Instagram.svg" alt="Instagram" className="w-4 md:w-6 h-4 md:h-6" />
                            </a>
                        </div>
                    </div>
                </div>

                {/* リード文（詩的に） */}
                <div className="mt-8 max-w-2xl text-gray-200 text-base md:text-lg leading-relaxed">
                    <p className="mb-3">
                        光と静けさを探してカメラを持ち歩いています。日常の細部を切り取り、時間の痕跡を写真に留めることを大切にしています。
                    </p>
                    <p>
                        技術より先に「見ること」を大事にし、意図的に余白を残す写真を心がけています。作品はオンラインで公開すると同時に、プリントと展示を中心に発表しています。
                    </p>
                </div>
            </div>
        </div>
    );
}
