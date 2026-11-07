import type { Metadata } from "next";
import { Outfit, Geist_Mono, Tenor_Sans } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  weight: ["300", "400", "500", "600", "700"],
});
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
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

// Restore saved UI preferences before first paint so nothing flashes.
// - Theme: light is the default; dark only when the user explicitly chose it,
//   regardless of the OS preference.
// - Agent panel: mirror the saved mode onto <html data-agent> (CSS lays the
//   panel out from it). Keep the mode list in sync with stores/agentPanel.ts.
const preferencesScript = `
(function () {
  try {
    var d = document.documentElement;
    if (localStorage.getItem("theme") === "dark") d.classList.add("dark");
    var a = localStorage.getItem("agent-mode");
    if (["docked", "minimized", "maximized", "closed"].indexOf(a) > -1) d.dataset.agent = a;
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: preferencesScript }} />
      </head>
      <body
        className={`${outfit.variable} ${geistMono.variable} ${tenorSans.variable} antialiased`}
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
