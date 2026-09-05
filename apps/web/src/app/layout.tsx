import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  description:
    "Dashboard local-first para gestionar issues asignadas de GitHub.",
  icons: {
    icon: "./favicon.ico",
  },
  title: "Issues Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      suppressHydrationWarning
      lang="es"
      className={`${inter.variable} ${mono.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
