import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  typescript: {
    // Don't fail build on TypeScript errors during development
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
