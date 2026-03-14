import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fitted x TaskRabbit",
  description: "Photo Grouping Portal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
