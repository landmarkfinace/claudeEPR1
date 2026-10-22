import type { Metadata, Viewport } from "next";
import { Inter, Cairo, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "@/components/app/providers";

// Inter — the Latin workhorse (UI + numbers, tabular-nums in CSS)
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// Cairo — Arabic (bilingual documents & Arabic UI text): proper OpenType
// shaping for connected letters, full RTL support, self-hosted by next/font
// so it embeds cleanly in the print PDFs.
const cairoArabic = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  display: "swap",
});

// Geist Mono — kbd hints, code, reference numbers
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Landmark Inter Gulf — Workforce, Payroll & Accounts",
  description:
    "Admin system for construction workforce supply: projects, staff, attendance, monthly payroll, salary slips & sheets, and company accounting (SAR).",
  keywords: ["workforce", "payroll", "construction", "SAR", "salary sheet", "attendance"],
  // favicon: src/app/icon.png (brand ML monogram) is auto-detected by Next.js
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // PWA-style safe areas (notched phones) — the topbar pads itself with env()
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${cairoArabic.variable} ${geistMono.variable} font-sans antialiased bg-background text-foreground`}
      >
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
