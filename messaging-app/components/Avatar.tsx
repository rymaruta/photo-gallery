type Props = {
  emoji: string;
  size?: "sm" | "md" | "lg";
};

const sizeClass: Record<NonNullable<Props["size"]>, string> = {
  sm: "h-8 w-8 text-lg",
  md: "h-12 w-12 text-2xl",
  lg: "h-20 w-20 text-4xl",
};

export default function Avatar({ emoji, size = "md" }: Props) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full bg-gray-200 ${sizeClass[size]}`}
      aria-hidden="true"
    >
      {emoji}
    </div>
  );
}
