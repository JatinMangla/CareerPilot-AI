/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      "pdf-parse",
      "mammoth",
      "imapflow",
      "mailparser",
      "nodemailer",
    ],
  },
};

export default nextConfig;
