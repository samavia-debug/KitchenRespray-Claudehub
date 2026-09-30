/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdf-parse pulls in pdfjs-dist, which breaks when webpack bundles it into
  // the RSC/route-handler bundle (fails with "Object.defineProperty called
  // on non-object" from its module-wrapping code) — this tells Next.js to
  // require() it at runtime instead of bundling it, same fix used for any
  // library not designed for that bundling context.
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "pdfjs-dist"],
    // pdfjs-dist loads its worker script from disk at runtime rather than
    // via a static import, so Next.js's file tracing can't see it and
    // silently drops it from the serverless function bundle — it works
    // locally (files are just on disk) but fails in production with
    // "Cannot find module .../pdf.worker.mjs". Force it in explicitly.
    outputFileTracingIncludes: {
      "/api/brain/extract-document": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
    },
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
