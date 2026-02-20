import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import SiteHeader from "./_components/SiteHeader";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.mediadealshub.com"),
  title: {
    default: "MediaDealsHub — Daily Amazon Deals on Physical Media",
    template: "%s | MediaDealsHub",
  },
  description:
    "MediaDealsHub tracks daily Amazon deals on vinyl, CDs, Blu-ray, 4K UHD, and DVDs. New items only, 15%+ off, best sellers first.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} bg-white text-slate-900`}
    >
      <body className="min-h-screen bg-white text-slate-900 antialiased">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
