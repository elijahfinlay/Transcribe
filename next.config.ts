import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: rootDir,
  outputFileTracingExcludes: {
    "/api/transcribe": [
      "node_modules/@img/**/*",
      "node_modules/onnxruntime-node/bin/napi-v3/darwin/**/*",
      "node_modules/onnxruntime-node/bin/napi-v3/linux/arm64/**/*",
      "node_modules/onnxruntime-node/bin/napi-v3/win32/**/*",
      "node_modules/sharp/**/*",
    ],
  },
  serverExternalPackages: [
    "@huggingface/transformers",
    "ffmpeg-static",
  ],
};

export default nextConfig;
