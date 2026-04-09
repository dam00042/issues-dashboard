import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const isProductionBuild = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  assetPrefix: isProductionBuild ? "./" : undefined,
  images: {
    unoptimized: true,
  },
  output: "export",
  trailingSlash: true,
  turbopack: {
    root: path.resolve(currentDirectory, "../.."),
  },
};

export default nextConfig;
