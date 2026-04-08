import type { Metadata } from "next";
import { IBM_Plex_Mono, Syne } from "next/font/google";
import { TopNav } from "./components/top-nav";
import "./globals.css";

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

const syne = Syne({
  variable: "--font-syne",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "synapse gateway | paid api and mcp operations",
  description:
    "operate paid contract APIs and MCP tools through the Synapse Stellar gateway with x402 flows, proof artifacts, and on-chain settlement visibility.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${ibmPlexMono.variable} ${syne.variable} h-full antialiased`}
    >
      <body className="app-body">
        <div className="app-shell">
          <TopNav />
          <div className="content-shell">{children}</div>
        </div>
      </body>
    </html>
  );
}
