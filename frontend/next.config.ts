import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone with a self-contained server.js and only the
  // node_modules actually traced as reachable. Needed for a small container
  // image on Cloud Run; without it the runtime stage has to carry the full
  // dependency tree.
  output: "standalone",
  images: {
    unoptimized: true,
  },
  typescript: {
    // Don't fail build on TypeScript errors during development
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
