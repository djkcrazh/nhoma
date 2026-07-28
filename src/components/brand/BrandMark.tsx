/**
 * Nhoma brand mark — a live recreation of the logo (Tenor Sans "N" inside a
 * thin circle, hairline rule above), rendered in `currentColor` so it's
 * WHITE on Ironwood's dark surfaces and crisp at any size, unlike the PNG.
 *
 * Requires Tenor Sans loaded in layout.tsx:
 *   import { Tenor_Sans } from "next/font/google";
 *   const tenor = Tenor_Sans({ subsets: ["latin"], weight: "400", variable: "--font-tenor" });
 *   ...add `tenor.variable` to the <body> className.
 *
 * Variants:
 *   <BrandMark />              — circled N (sidebar header, login card)
 *   <BrandMark bare />         — just the N, no circle (favicons-in-UI, footers)
 *   <BrandMark wordmark />     — circled N + "NHOMA" lockup
 *
 * The original PNG (brand/nhoma-logo.png) is included in the kit for
 * marketing/export use; in-app, prefer this component.
 */

export function BrandMark({
  size = 36,
  bare = false,
  wordmark = false,
  className = "",
}: {
  size?: number;
  bare?: boolean;
  wordmark?: boolean;
  className?: string;
}) {
  const n = (
    <span
      aria-hidden
      style={{
        fontFamily: "var(--font-tenor), 'Tenor Sans', serif",
        fontSize: size * (bare ? 0.9 : 0.52),
        lineHeight: 1,
        letterSpacing: "0.02em",
        transform: "translateY(1%)",
      }}
    >
      N
    </span>
  );

  const mark = bare ? (
    n
  ) : (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: "1.5px solid currentColor",
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: size * 0.06,
        flex: "none",
      }}
    >
      {/* hairline rule above the N, as in the source logo */}
      <span
        style={{
          width: size * 0.34,
          height: 1,
          background: "currentColor",
          opacity: 0.55,
        }}
      />
      {n}
    </span>
  );

  if (!wordmark) return <span className={`brand-mark ${className}`}>{mark}</span>;

  return (
    <span
      className={`brand-mark ${className}`}
      style={{ display: "inline-flex", alignItems: "center", gap: size * 0.32 }}
    >
      {mark}
      <span
        style={{
          fontFamily: "var(--font-tenor), 'Tenor Sans', serif",
          fontSize: size * 0.42,
          letterSpacing: "0.34em",
          marginRight: "-0.34em",
        }}
      >
        NHOMA
      </span>
    </span>
  );
}
