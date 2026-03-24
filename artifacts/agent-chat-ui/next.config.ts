import type { NextConfig } from "next";

const devDomain = process.env.REPLIT_DEV_DOMAIN;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@workspace/api-client-react"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8080/api/:path*",
      },
    ];
  },
  allowedDevOrigins: devDomain ? [devDomain] : [],
  serverExternalPackages: [],
};

export default nextConfig;
