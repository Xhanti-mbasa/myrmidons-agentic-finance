import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Shucamoxa - Owner Controls",
  description: "Owner-controlled invoice-payment agent for small importers",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#f8fafc",
          color: "#0f172a",
        }}
      >
        {children}
      </body>
    </html>
  );
}
