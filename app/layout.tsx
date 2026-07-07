import type { Metadata } from "next";
import { Space_Grotesk, Sora, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Shell from "@/components/Shell";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });
const body = Sora({ subsets: ["latin"], variable: "--font-body" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "CareerPilot AI",
  description: "Your AI career copilot — resume, jobs, applications, interviews.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} ${mono.variable}`}>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
