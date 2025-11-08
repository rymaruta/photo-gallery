// app/about/page.tsx
export default function AboutPage() {
    return (
        <div className="min-h-screen text-white">
            <div className="mx-auto max-w-screen-lg p-8 rounded-md">
                <div className="flex items-start gap-4 md:items-center">
                    {/* プロフィール画像: モバイル 64px, デスクトップ 112px */}
                    <img
                        src="/avatar.jpg"
                        alt="プロフィール画像"
                        className="w-16 h-16 md:w-28 md:h-28 rounded-full object-cover flex-shrink-0"
                    />

                    <div className="flex-1">
                        <h1 className="text-2xl md:text-3xl font-bold">まるたりゅうへい</h1>
                        <p className="text-sm md:text-base text-gray-300 mt-1">
                            Frontend Engineer / Next.js · TypeScript · Tailwind CSS
                        </p>

                        {/* SNS アイコン群: ボタンはモバイル 36px, デスクトップ 48px */}
                        <div className="mt-4 flex items-center gap-3 md:gap-4">
                            <a
                                href="https://www.instagram.com/your_handle"
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="Instagram (opens in new tab)"
                                className="inline-flex items-center justify-center w-9 md:w-12 h-9 md:h-12 rounded-full  hover:bg-white/10 transition-colors"
                            >
                                <img src="/Instagram.svg" alt="Instagram" className="w-4 md:w-6 h-4 md:h-6" />
                            </a>

                            <a
                                href="https://github.com/your-username"
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="GitHub (opens in new tab)"
                                className="inline-flex items-center justify-center w-9 md:w-12 h-9 md:h-12 rounded-full  hover:bg-white/10 transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 md:w-6 h-4 md:h-6 text-white" aria-hidden="true">
                                    <path d="M12 .5a12 12 0 00-3.8 23.4c.6.1.8-.2.8-.5v-2c-3.3.7-4-1.6-4-1.6-.5-1.3-1.2-1.6-1.2-1.6-1-.7.1-.7.1-.7 1.1.1 1.7 1.1 1.7 1.1 1 .1.7 1.8 2.6 2.3.6.2 1.2.2 1.8.1.1-.8.4-1.5.8-1.8-2.7-.3-5.5-1.3-5.5-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.4 11.4 0 016 0c2.3-1.6 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.8 1.2 3.1 0 4.5-2.8 5.5-5.5 5.8.4.3.8 1 .8 2v3c0 .3.2.6.8.5A12 12 0 0012 .5z" />
                                </svg>
                            </a>

                            <a
                                href="https://twitter.com/your_handle"
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="Twitter (opens in new tab)"
                                className="inline-flex items-center justify-center w-9 md:w-12 h-9 md:h-12 rounded-full  hover:bg-white/10 transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 md:w-6 h-4 md:h-6 text-sky-400" aria-hidden="true">
                                    <path d="M22 5.9c-.6.3-1.2.5-1.9.6.7-.4 1.2-1 1.4-1.7-.6.4-1.4.7-2.2.9C18.7 5 17.6 4.5 16.4 4.5c-1.7 0-3.1 1.4-3.1 3.1 0 .2 0 .4.1.6-2.6-.1-5-1.4-6.5-3.4-.3.6-.5 1.3-.5 2 0 1.3.7 2.4 1.7 3-.5 0-1-.1-1.5-.4v.1c0 1.9 1.4 3.4 3.2 3.8-.3.1-.7.1-1 .1-.3 0-.6 0-.9-.1.6 1.8 2.3 3.1 4.2 3.1-1.6 1.3-3.6 2-5.7 2-.4 0-.8 0-1.2-.1C6.4 20 8.8 21 11.5 21c7.4 0 11.4-6.1 11.4-11.4v-.5c.8-.6 1.5-1.4 2-2.2-.7.3-1.4.5-2.1.6z" />
                                </svg>
                            </a>
                        </div>
                    </div>
                </div>

                {/* 自己紹介テキスト */}
                <div className="mt-6 text-base md:text-lg leading-relaxed text-gray-200">
                    <p className="mb-3">
                        こんにちは、まるたりゅうへいです。モダンなフロントエンド開発を中心に活動しています。Next.js、TypeScript、Tailwind CSS を使った
                        プロダクト設計と実装が得意です。
                    </p>
                    <p>
                        ドキュメント整備やワークフロー改善が好きで、読みやすい README と再現性の高い開発体験を大切にしています。
                    </p>
                </div>
            </div>
        </div>
    );
}
