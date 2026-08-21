import type { ReactNode } from "react";

export type IconName =
  | "arrow-right"
  | "book"
  | "cards"
  | "check"
  | "chevron-down"
  | "chevron-right"
  | "close"
  | "clock"
  | "edit"
  | "grid"
  | "keyboard"
  | "layers"
  | "menu"
  | "more"
  | "play"
  | "plus"
  | "refresh"
  | "shuffle"
  | "spark"
  | "trash"
  | "upload";

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

/** Small inline icons keep the interface crisp without adding a UI dependency. */
export default function Icon({ name, size = 18, strokeWidth = 1.8, className }: IconProps) {
  const paths: Record<IconName, ReactNode> = {
    "arrow-right": <><path d="M4 12h15" /><path d="m13 6 6 6-6 6" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" /><path d="M4 5.5v16" /><path d="M8 7h8" /><path d="M8 11h6" /></>,
    cards: <><rect x="5" y="5" width="13" height="15" rx="2" /><path d="M8 2h9a2 2 0 0 1 2 2v14" /><path d="M9 10h5" /><path d="M9 14h3" /></>,
    check: <path d="m5 12 4.2 4.2L19.5 6" />,
    "chevron-down": <path d="m6 9 6 6 6-6" />,
    "chevron-right": <path d="m9 6 6 6-6 6" />,
    close: <><path d="m6 6 12 12" /><path d="m18 6-12 12" /></>,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></>,
    edit: <><path d="m14.5 5.5 4 4" /><path d="m4 20 3.3-.7L19.7 6.9a2.1 2.1 0 0 0-3-3L4.7 16.3 4 20Z" /><path d="m14 7 3 3" /></>,
    grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    keyboard: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7 14h10" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 16 9 5 9-5" /></>,
    menu: <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
    play: <path d="m9 6 9 6-9 6V6Z" />,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    refresh: <><path d="M19 8a7.5 7.5 0 1 0 1 6" /><path d="M19 4v4h-4" /></>,
    shuffle: <><path d="M3 7h2.5c3.5 0 5 10 9 10H21" /><path d="m18 14 3 3-3 3" /><path d="M3 17h2.5c1 0 1.8-.7 2.5-1.7" /><path d="M14.5 8.7C15.2 7.7 16 7 17 7h4" /><path d="m18 4 3 3-3 3" /></>,
    spark: <><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z" /><path d="m19 17 .7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7L19 17Z" /></>,
    trash: <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="m7 7 .8 13h8.4L17 7" /><path d="M10 11v5M14 11v5" /></>,
    upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 15v4h14v-4" /></>,
  };

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth}>
        {paths[name]}
      </g>
    </svg>
  );
}
