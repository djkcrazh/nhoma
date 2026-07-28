import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide Next.js's built-in dev indicator; the app ships its own draggable
  // Nhoma badge (see components/brand/FloatingBadge) that also exists in prod.
  devIndicators: false,
};

export default nextConfig;
