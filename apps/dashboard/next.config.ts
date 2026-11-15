import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/v1/:path*',
        destination: `${process.env.API_BASE_URL || 'http://localhost:3000'}/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
