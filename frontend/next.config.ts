import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Ensure TypeScript path mapping works correctly
    typedRoutes: true,
  },
  typescript: {
    // Don't fail build on TypeScript errors during development
    ignoreBuildErrors: false,
  },
  // Ensure proper path resolution for @/* imports
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': require('path').resolve(__dirname, './src'),
    };
    return config;
  },
};

export default nextConfig;
