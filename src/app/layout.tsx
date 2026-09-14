import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "next-themes";

// Handwriting signature fonts are bundled locally (no CDN) so that the
// signature a signer sees is exactly the signature that gets affixed.
import "@fontsource/caveat/400.css";
import "@fontsource/caveat/600.css";
import "@fontsource/dancing-script/500.css";
import "@fontsource/great-vibes/400.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Docurama — Enterprise Portal & Admin Control Panel",
  description:
    "Docurama platform console: document signing, PAdES cryptographic verification, tenant administration, compliance operations and trust analytics.",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%235645d4'/%3E%3Cpath d='M9 20.5 13.5 25 23 11.5' stroke='white' stroke-width='3.4' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          {children}
          <Toaster position="bottom-right" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
