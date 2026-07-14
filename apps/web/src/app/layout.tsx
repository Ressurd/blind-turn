import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./online.css";

export const metadata: Metadata = {
  title: "BLIND TURN — Local Battle Lab",
  description: "친구들과 즐기는 서버 권한형 턴제 심리전 BLIND TURN",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
