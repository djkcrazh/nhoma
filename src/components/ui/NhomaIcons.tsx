/**
 * Nhoma icon set — monochrome, stroke-based, no emoji.
 * All icons draw in `currentColor`, so they render white on dark surfaces
 * and ink-colored on light ones. Pair with the `.nhoma-icon` CSS class
 * (see themes/*.css) for the subtle darken-on-hover interaction.
 *
 * Usage:  <Icon.Pigs className="nhoma-icon" size={18} />
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 18, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/* Brand mark — an abstract "N" formed by two fence posts and a rail,
   nodding to the farm without literal imagery. Use in sidebar + login. */
export function LogoMark({ size = 26, ...props }: IconProps) {
  return (
    <Base size={size} strokeWidth="2" {...props}>
      <path d="M5 20V5" />
      <path d="M19 20V5" />
      <path d="M5 7l14 11" />
    </Base>
  );
}

/* Overview — four field plots seen from above */
export function Overview(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </Base>
  );
}

/* Pigs — minimal snout: rounded square, two nostrils */
export function Pigs(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3.5" y="6.5" width="17" height="11" rx="5.5" />
      <circle cx="9.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <path d="M6 7l-1.5-2M18 7l1.5-2" />
    </Base>
  );
}

/* Breeding — two interlinked rings (pairing) */
export function Breeding(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="9" cy="12" r="5" />
      <circle cx="15" cy="12" r="5" />
    </Base>
  );
}

/* Analytics — rising line over a baseline */
export function Analytics(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 19h16" />
      <path d="M5 14l4-4 3.5 3L19 6" />
      <path d="M15.5 6H19v3.5" />
    </Base>
  );
}

/* Alerts — bell */
export function Alerts(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 14 6 10Z" />
      <path d="M10.2 19a2 2 0 0 0 3.6 0" />
    </Base>
  );
}

/* Settings — gear, simplified */
export function Settings(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M21 12h-2.5M5.5 12H3M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8M18.4 18.4l-1.8-1.8M7.4 7.4L5.6 5.6" />
    </Base>
  );
}

/* Weight — hanging scale */
export function Weight(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M9 6a3 3 0 0 1 6 0" />
      <path d="M5.5 6h13l1.5 13a1.8 1.8 0 0 1-1.8 2H5.8A1.8 1.8 0 0 1 4 19L5.5 6Z" />
    </Base>
  );
}

/* Add — plus in nothing; keep it bare for buttons */
export function Plus(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 5v14M5 12h14" />
    </Base>
  );
}

/* Sun — light-mode toggle state */
export function Sun(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12h2.5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8" />
    </Base>
  );
}

/* Moon — dark-mode toggle state */
export function Moon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
    </Base>
  );
}

/* Search — global search field */
export function Search(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.3-4.3" />
    </Base>
  );
}

/* Close — dismiss / clear */
export function Close(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Base>
  );
}

/* Check — confirmation / availability */
export function Check(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </Base>
  );
}

/* Notes — a written page */
export function Notes(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 3.5h9l3 3V20a.6.6 0 0 1-.6.6H6.6A.6.6 0 0 1 6 20V3.5Z" />
      <path d="M9 9h6M9 13h6M9 17h3.5" />
    </Base>
  );
}

/* Document — CSV / file import-export */
export function Document(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M7 3.5h7l4 4V20a.6.6 0 0 1-.6.6H7.6A.6.6 0 0 1 7 20V3.5Z" />
      <path d="M14 3.5V8h4" />
    </Base>
  );
}

/* Chevron down — dropdown affordance */
export function ChevronDown(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 9l6 6 6-6" />
    </Base>
  );
}

/* User — account avatar fallback */
export function User(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </Base>
  );
}

/* Edit — pencil, for record edits */
export function Edit(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 20l.9-4L16 4.9a1.8 1.8 0 0 1 2.5 0l.6.6a1.8 1.8 0 0 1 0 2.5L8 19.1 4 20Z" />
      <path d="M14 6.5L17.5 10" />
    </Base>
  );
}

/* Sold — a tag with a check, currency/exchange complete */
export function Sold(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M11 4h6a1 1 0 0 1 1 1v6l-8.5 8.5a1.4 1.4 0 0 1-2 0L4 16a1.4 1.4 0 0 1 0-2L11 4Z" />
      <circle cx="15.5" cy="8.5" r="1" fill="currentColor" stroke="none" />
    </Base>
  );
}

/* Deceased — a plain marker, kept understated by design */
export function Deceased(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 3v6M9 6h6" />
      <path d="M7 21V13a5 5 0 0 1 10 0v8" />
      <path d="M5 21h14" />
    </Base>
  );
}

/* File — plain document, for CSV import/export dropzones */
export function File(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M7 3.5h7l4 4V20a.6.6 0 0 1-.6.6H7.6A.6.6 0 0 1 7 20V3.5Z" />
      <path d="M10 13.5l1.7 1.7L15 12" />
    </Base>
  );
}

/* Litter — small clustered dots, for farrowed piglets */
export function Litter(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="7" cy="8" r="2.4" />
      <circle cx="17" cy="8" r="2.4" />
      <circle cx="12" cy="14.5" r="2.4" />
      <circle cx="6" cy="18.5" r="1.6" />
      <circle cx="18" cy="18.5" r="1.6" />
    </Base>
  );
}

/* Family tree — two parent nodes branching down to a child node */
export function FamilyTree(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="6.5" cy="5.5" r="2.2" />
      <circle cx="17.5" cy="5.5" r="2.2" />
      <circle cx="12" cy="18.5" r="2.2" />
      <path d="M6.5 7.7v3.3a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V7.7" />
      <path d="M12 13v3.3" />
    </Base>
  );
}

/* Menu — vertical dots, row-action trigger */
export function Menu(props: IconProps) {
  return (
    <Base {...props} strokeWidth="0">
      <circle cx="12" cy="5.5" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="18.5" r="1.6" fill="currentColor" />
    </Base>
  );
}

export const Icon = {
  LogoMark,
  Overview,
  Pigs,
  Breeding,
  Analytics,
  Alerts,
  Settings,
  Weight,
  Plus,
  Sun,
  Moon,
  Search,
  Close,
  Check,
  Notes,
  Document,
  ChevronDown,
  User,
  Edit,
  Sold,
  Deceased,
  File,
  Litter,
  Menu,
  FamilyTree,
};
