import type { Metadata } from "next";
import { Roboto_Slab, Source_Sans_3, IBM_Plex_Mono, Tenor_Sans } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const robotoSlab = Roboto_Slab({
  subsets: ["latin"],
  variable: "--font-roboto-slab",
  weight: ["400", "500", "600", "700"],
});
const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source-sans",
  weight: ["400", "500", "600", "700"],
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
});
const tenorSans = Tenor_Sans({
  subsets: ["latin"],
  variable: "--font-tenor",
  weight: "400",
});

export const metadata: Metadata = {
  title: "Nhoma",
  description: "Nhoma · pig farm management",
};

// Apply saved theme before paint; manual choice overrides OS preference.
const themeScript = `
(function () {
  try {
    var t = localStorage.getItem("theme");
    var dark = t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={`${robotoSlab.variable} ${sourceSans.variable} ${plexMono.variable} ${tenorSans.variable} antialiased`}
      >
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: "var(--ground-raised)",
              color: "var(--ink)",
              border: "1px solid var(--rule-strong)",
              fontFamily: "var(--font-body)",
            },
          }}
        />
      </body>
    </html>
  );
}
