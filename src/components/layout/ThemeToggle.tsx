"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/NhomaIcons";

export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    // Deferred so the post-hydration state sync doesn't cascade renders
    const id = requestAnimationFrame(() =>
      setDark(document.documentElement.classList.contains("dark"))
    );
    return () => cancelAnimationFrame(id);
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
    setDark(next);
  }

  return (
    <button
      onClick={toggle}
      className="btn btn-ghost btn-sm h-9 w-9 rounded-full p-0"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
    >
      {dark === null ? null : dark ? (
        <Icon.Sun className="nhoma-icon" size={17} />
      ) : (
        <Icon.Moon className="nhoma-icon" size={17} />
      )}
    </button>
  );
}
