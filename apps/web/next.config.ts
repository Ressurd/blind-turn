import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@blind-turn/shared", "@blind-turn/game-engine"],
};

export default nextConfig;
