/**
 * The nav's icons, drawn on one grid so they read as a set. It used to mix text
 * symbols and emoji, which render differently per platform, and two pages shared
 * the same diamond. Inline paths, so no icon package and no extra request.
 */
const PATHS = {
  home: "M3 11l9-8 9 8M5 9.5V20h5v-6h4v6h5V9.5",
  file: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  check: "M4 12.5l5 5L20 6.5",
  scissors: "M6 8a2.5 2.5 0 100-5 2.5 2.5 0 000 5zm0 13a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM8 7l12 11M8 17L20 6",
  target: "M12 21a9 9 0 100-18 9 9 0 000 18zm0-5a4 4 0 100-8 4 4 0 000 8zm0-3a1 1 0 100-2 1 1 0 000 2z",
  people: "M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.900 1.900 6.500 5.500M16 4.300a3.500 3.500 0 010 6.400M18 14.800c2 .7 3.200 2.500 3.500 5.200",
  send: "M21 3L10.500 13.500M21 3l-6.500 18-4-7.500L3 9.500z",
  code: "M8 7l-5 5 5 5M16 7l5 5-5 5M13.500 5l-3 14",
  inbox: "M3 13l3-9h12l3 9v7H3zM3 13h5l1.500 3h5L16 13h5",
  mail: "M3 6h18v13H3zM3 7l9 7 9-7",
  mic: "M12 15a3.500 3.500 0 003.500-3.500v-5a3.500 3.500 0 00-7 0v5A3.500 3.500 0 0012 15zM5.500 11.500a6.500 6.500 0 0013 0M12 18v3",
  terminal: "M3 5h18v14H3zM7 9.500l3 2.500-3 2.500M12.500 15H17",
  spark: "M12 3l1.900 5.600L19.500 10l-5.600 1.900L12 18l-1.900-6.100L4.500 10l5.600-1.400zM19 16l.8 2.200L22 19l-2.200.8L19 22l-.8-2.200L16 19l2.200-.8z",
  user: "M12 12a4.500 4.500 0 100-9 4.500 4.500 0 000 9zM4 21c.8-4.200 4-6.500 8-6.500s7.200 2.300 8 6.500",
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({ name, className = "w-[18px] h-[18px]" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
