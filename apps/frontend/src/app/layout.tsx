import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kyverno Governance Platform",
  description: "Kubernetes PaC 정책 위반 대응 및 예외 관리 시스템",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
