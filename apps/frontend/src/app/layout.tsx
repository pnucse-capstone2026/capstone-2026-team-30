import type { Metadata } from "next";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

export const metadata: Metadata = {
  title: "Kyverno Governance Platform",
  description:
    "Kubernetes Policy as Code \uc815\ucc45 \uc704\ubc18 \ud0d0\uc9c0 \ubc0f \uc608\uc678 \uad00\ub9ac \uc2dc\uc2a4\ud15c",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="font-sans">
      <body>
        <TooltipProvider>
          {children}
          <Toaster />
        </TooltipProvider>
      </body>
    </html>
  );
}
