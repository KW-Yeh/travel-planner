import type { ReactNode } from "react";
import type { LegMode, StopKind } from "../../shared/schema";

type IconProps = { size?: number; strokeWidth?: number };

function Svg({ size = 22, strokeWidth = 1.8, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const MapIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />
  </Svg>
);
export const PlusIcon = (p: IconProps) => (
  <Svg strokeWidth={2.4} {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const MinusIcon = (p: IconProps) => (
  <Svg strokeWidth={2.4} {...p}>
    <path d="M5 12h14" />
  </Svg>
);
export const CloseIcon = (p: IconProps) => (
  <Svg strokeWidth={2} {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const BackIcon = (p: IconProps) => (
  <Svg strokeWidth={2} {...p}>
    <path d="m15 6-6 6 6 6" />
  </Svg>
);
export const ChevronIcon = (p: IconProps) => (
  <Svg strokeWidth={2} {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);
export const ListIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
  </Svg>
);
export const TicketIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" />
  </Svg>
);
export const WarningIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4 2.5 20h19zM12 10v5M12 17.5h.01" />
  </Svg>
);
export const SettingsIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Svg>
);
export const EditIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
  </Svg>
);
export const GripIcon = (p: IconProps) => (
  <Svg strokeWidth={2.2} {...p}>
    <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />
  </Svg>
);
export const UpIcon = (p: IconProps) => (
  <Svg strokeWidth={2} {...p}>
    <path d="m6 15 6-6 6 6" />
  </Svg>
);
export const DownIcon = (p: IconProps) => (
  <Svg strokeWidth={2} {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
export const PinIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10z" />
    <circle cx="12" cy="11" r="2" />
  </Svg>
);
export const SearchIcon = (p: IconProps) => (
  <Svg strokeWidth={2} {...p}>
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-4.5-4.5" />
  </Svg>
);
export const CopyIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a1 1 0 0 1 1-1h10" />
  </Svg>
);
export const NavigateIcon = (p: IconProps) => (
  <Svg strokeWidth={2} {...p}>
    <path d="m4 11 16-7-7 16-2-7z" />
  </Svg>
);
export const FileIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5" />
  </Svg>
);

export function ModeIcon({ mode, ...p }: IconProps & { mode: LegMode }) {
  switch (mode) {
    case "transit":
      return (
        <Svg {...p}>
          <rect x="6" y="3" width="12" height="14" rx="3" />
          <path d="M6 11h12M9 21l2-4M15 21l-2-4M9.5 14h.01M14.5 14h.01" />
        </Svg>
      );
    case "drive":
      return (
        <Svg {...p}>
          <path d="M5 16v-5l2-5h10l2 5v5M5 16h14M5 16v2M19 16v2M5 11h14" />
        </Svg>
      );
    case "walk":
      return (
        <Svg {...p}>
          <circle cx="13" cy="4.5" r="1.5" />
          <path d="m10 21 2-6-2-3 1-4 3 3 3 1M8 13l1-4 2-1" />
        </Svg>
      );
    case "bicycle":
      return (
        <Svg {...p}>
          <circle cx="6" cy="16" r="3.5" />
          <circle cx="18" cy="16" r="3.5" />
          <path d="M6 16l4-8h5l3 8M10 8l4 8" />
        </Svg>
      );
  }
}

export function KindIcon({ kind, ...p }: IconProps & { kind: StopKind }) {
  switch (kind) {
    case "sight":
      return (
        <Svg {...p}>
          <path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6" />
        </Svg>
      );
    case "food":
      return (
        <Svg {...p}>
          <path d="M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 0-4 2-4 6v4h4" />
        </Svg>
      );
    case "lodging":
      return (
        <Svg {...p}>
          <path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5" />
          <circle cx="7" cy="11" r="2" />
        </Svg>
      );
    case "transport":
      return (
        <Svg {...p}>
          <rect x="5" y="3" width="14" height="14" rx="3" />
          <path d="M5 11h14M8 21l1.5-4M16 21l-1.5-4" />
        </Svg>
      );
    case "other":
      return (
        <Svg strokeWidth={2.6} {...p}>
          <path d="M6 12h.01M12 12h.01M18 12h.01" />
        </Svg>
      );
  }
}
