/**
 * Satır içi SVG simgeler (24×24, `currentColor`). Simge yazı tipi veya ağdan
 * görsel yok: uygulama çevrimdışı ve paket bütçesi dar.
 */
const PATHS = {
  project: 'M4 6h7v5H4zM13 6h7v5h-7zM4 13h7v5H4zM15.5 13v5M13 15.5h5',
  output: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 15.5h7M9 19h4',
  library: 'M4 5h5v14H4zM10 5h4v14h-4zM15.4 5.6l4-1.1 3.6 13.5-4 1.1z',
  settings:
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-2 1.2L14.8 21h-4l-.3-2.4a7 7 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-2.4L4.6 9.9l2-3.4 1.9.7a7 7 0 0 1 2-1.2L10.8 3h4l.3 2.4a7 7 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 2.4z',
  back: 'M15 5l-7 7 7 7M8 12h12',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9h-13zM12 14.5v2',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5L20 20',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  trash: 'M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13M10.5 11v5.5M13.5 11v5.5',
  share: 'M12 4v11M7.5 8.5L12 4l4.5 4.5M5 13v6h14v-6',
  download: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14',
  upload: 'M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19h14',
  more: 'M12 6.5v.01M12 12v.01M12 17.5v.01',
  backspace: 'M9 5h11v14H9l-6-7zM12.5 9.5l5 5M17.5 9.5l-5 5',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  warning: 'M12 4l9 16H3zM12 10v4.5M12 17.5v.01',
  refresh: 'M19 12a7 7 0 1 1-2.1-5M19 4v4h-4',
  empty: 'M4 8l8-4 8 4-8 4zM4 8v8l8 4 8-4V8M12 12v8',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 24,
  label,
  className,
  strokeWidth = 1.9,
}: {
  name: IconName;
  size?: number;
  /** Verilirse simge erişilebilir bir ada sahip olur; verilmezse süs sayılır. */
  label?: string;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      className={className ? `m-icon ${className}` : 'm-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'more' ? 3.2 : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
