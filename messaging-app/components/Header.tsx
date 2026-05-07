"use client";

import Link from "next/link";

type Props = {
  title: string;
  back?: string;
  right?: React.ReactNode;
};

export default function Header({ title, back, right }: Props) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between bg-line px-4 py-3 text-white shadow">
      <div className="flex items-center gap-2 min-w-0">
        {back && (
          <Link href={back} aria-label="戻る" className="text-xl leading-none">
            ‹
          </Link>
        )}
        <h1 className="truncate text-base font-semibold">{title}</h1>
      </div>
      <div className="flex items-center gap-3">{right}</div>
    </header>
  );
}
