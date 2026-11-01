import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Space_Grotesk, Sora, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Shell from "@/components/Shell";

// Named apart from Tailwind's own --font-* theme keys, which point at these.
const display = Space_Grotesk({ subsets: ["latin"], variable: "--next-font-display" });
const body = Sora({ subsets: ["latin"], variable: "--next-font-body" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--next-font-mono" });

// No `title`: components/Shell.tsx renders it per page.
export const metadata: Metadata = {
  description: "Your AI career copilot — resume, jobs, applications, interviews.",
  // Personal data behind a login; nothing here belongs in a search index.
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "CareerPilot", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0a0e17",
  colorScheme: "dark",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Renders per request: the nonce in proxy.ts only reaches a page rendered with
  // that request. A prerendered page has scripts with no nonce, and they would all
  // be blocked.
  await connection();
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} ${mono.variable}`}>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
