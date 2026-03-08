import type { NextConfig } from "next";

const browserWorkerHeaders = [
  {
    key: "Cross-Origin-Embedder-Policy",
    value: "require-corp",
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/",
        headers: [
          ...browserWorkerHeaders,
          {
            key: "Cache-Control",
            value: "no-store, max-age=0, must-revalidate",
          },
        ],
      },
      {
        source: "/(.*)",
        headers: browserWorkerHeaders,
      },
    ];
  },
};

export default nextConfig;
