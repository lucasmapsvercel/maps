import type { NextConfig } from "next";
import { validateRuntimeConfig } from "./src/infrastructure/server/runtime-config";

validateRuntimeConfig(process.env);

const config: NextConfig = {
  output: process.env.BUILD_STANDALONE === "true" ? "standalone" : undefined,
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
      ]
    }];
  }
};

export default config;
