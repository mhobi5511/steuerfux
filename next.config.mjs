/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/invoices/\\[id\\]/pdf": [
      "./node_modules/pdfkit/js/standard-fonts/**/*"
    ]
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb"
    }
  }
};

export default nextConfig;
