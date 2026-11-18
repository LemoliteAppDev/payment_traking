import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Next's dev-tools badge defaults to bottom-left, which is exactly where the
  // payment detail puts its Delete button — it sat on top of it on a phone.
  devIndicators: false,
};

export default nextConfig;
