import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./online.css";

export const metadata: Metadata = {
  title: "BLIND TURN",
  description: "카드 큐와 동시 단계 판정으로 즐기는 서버 권한형 심리전",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
