import type { Metadata, Viewport } from "next";
import { Fraunces, Karla } from "next/font/google";
import "./globals.css";

// Display face, used in exactly two places: the names on the sign-in screen
// and the header wordmark. Its soft axis carries the warmth so nothing else
// has to decorate.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

// Everything else. Open apertures and a tall x-height keep it readable at the
// sizes older guests need on a phone.
const karla = Karla({
  variable: "--font-karla",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Javier & Emily's Wedding",
  description: "Share and view photos from Javier & Emily's wedding",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Matches --color-ink so the phone's browser chrome blends into the page.
  themeColor: "#191320",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fraunces.variable} ${karla.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
