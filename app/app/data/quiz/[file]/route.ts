import { dailyQuizFor, quizDates } from "@/lib/data/quizFeed";
import { withPlaceholderParam, EMPTY_PARAM_PLACEHOLDER } from "@/lib/server/staticParams";

/**
 * **今日の一問**（`/app/data/quiz/<YYYY-MM-DD>.json`）。ビルドした日の前日から 60 日ぶん、
 * 日ごとに1ファイル書き出す（`lib/data/quizFeed.ts`）。Web の `/q` とアプリが同じファイルを読む。
 * `.json` は `public, max-age=3600` で配られ、デプロイのたびに CDN から消される。
 */
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams(): { file: string }[] {
    return withPlaceholderParam(
        quizDates().filter((d) => dailyQuizFor(d)).map((d) => ({ file: `${d}.json` })),
        "file",
    );
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }): Promise<Response> {
    const { file } = await params;
    if (file === EMPTY_PARAM_PLACEHOLDER) {
        return new Response("null", { headers: { "Content-Type": "application/json; charset=utf-8" } });
    }
    const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(file);
    const quiz = m ? dailyQuizFor(m[1]) : null;
    if (!quiz) return new Response("Not Found", { status: 404 });
    return new Response(JSON.stringify(quiz), {
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
        },
    });
}
