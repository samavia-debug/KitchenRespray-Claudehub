/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdf-parse pulls in pdfjs-dist, which breaks when webpack bundles it into
  // the RSC/route-handler bundle (fails with "Object.defineProperty called
  // on non-object" from its module-wrapping code) — this tells Next.js to
  // require() it at runtime instead of bundling it, same fix used for any
  // library not designed for that bundling context.
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "pdfjs-dist"],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, must-revalidate' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
