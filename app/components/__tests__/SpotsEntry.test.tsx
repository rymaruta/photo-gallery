import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { HomeSeasonal } from "../../../lib/data/spotTopics";

vi.mock("next/link", () => ({
    default: ({ href, children, ...props }: React.PropsWithChildren<{ href: string; [key: string]: unknown }>) =>
        <a href={href} {...props}>{children}</a>,
}));

vi.mock("../HomeEntryRow", () => ({
    default: ({ href, eyebrow, text }: { href: string; eyebrow: string; text: string }) =>
        <a href={href}>{eyebrow}: {text}</a>,
}));

vi.mock("../SpotTopicLists", () => ({
    TopicCreditLine: ({ credit }: { credit: string }) => <span>{credit}</span>,
}));

vi.mock("../SaveSpotButton", () => ({
    default: (props: { slug: string; name: string; locale: string; kind?: string; variant?: string }) => (
        <button
            type="button"
            data-testid={`save-${props.slug}`}
            data-kind={props.kind}
            data-variant={props.variant}
            data-locale={props.locale}
        >
            {props.locale === "en" ? "Want to go" : "行きたい"}
        </button>
    ),
}));

import SpotsEntry from "../SpotsEntry";

const seasonal = {
    season: "autumn",
    href: "/spots/season/autumn",
    total: 1,
    spots: [{
        slug: "takaya-jinja",
        name: "高屋神社",
        region: "香川県",
        src: "/images/takaya.jpg",
        alt: "高屋神社",
        credit: null,
    }],
} as HomeSeasonal;

describe("ホームの季節の撮影スポット", () => {
    it("スポット詳細へのリンクに加えて、公式スポットとして保存する操作を表示する", () => {
        render(<SpotsEntry locale="ja" seasonal={seasonal} />);

        expect(screen.getByRole("link", { name: "高屋神社" }).getAttribute("href")).toBe("/spots/takaya-jinja");
        const save = screen.getByTestId("save-takaya-jinja");
        expect(save.textContent).toBe("行きたい");
        expect(save.getAttribute("data-kind")).toBe("spot");
        expect(save.getAttribute("data-variant")).toBe("tile");
        expect(save.getAttribute("data-locale")).toBe("ja");
    });

    it("季節の候補がなければ保存ボタンも出さない", () => {
        render(<SpotsEntry locale="ja" seasonal={null} />);
        expect(screen.queryByTestId("save-takaya-jinja")).toBeNull();
    });
});
