import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack disabled to ensure proper PostCSS/Tailwind processing
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
