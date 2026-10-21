import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // Always defined at build time, so the e2e hooks (lib/e2e-hooks.ts) are compiled in only by an
  // e2e build (NEXT_PUBLIC_E2E=1): in a plain build the check is the constant "" !== "1" and the
  // minifier drops the hook code, which `pnpm check:no-e2e-hooks` then verifies.
  env: { NEXT_PUBLIC_E2E: process.env.NEXT_PUBLIC_E2E ?? "" },
  images: { unoptimized: true },
  transpilePackages: ["@lwa/engine"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
