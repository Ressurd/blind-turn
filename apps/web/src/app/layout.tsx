import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./online.css";

export const metadata: Metadata = {
  title: "BLIND TURN",
  description: "한 턴에 카드 한 장을 선택해 동시에 판정하는 서버 권한형 심리전",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
