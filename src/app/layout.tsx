import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "82-0 Hockey",
  description: "Build the ultimate all-time NHL team and see if you can go 82-0",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className={`${geist.className} min-h-full flex flex-col bg-background text-foreground`}>
        {children}
      </body>
    </html>
  );
}
