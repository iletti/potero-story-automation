import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Potero Story Automation",
  description: "Schedule and publish Stories through Outstand.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
