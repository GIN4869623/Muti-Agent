import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "多智能体协同控制台",
  description: "Multi-Agent Coordination Center — Agent SDR Live",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var d=t?t==='dark':m;document.documentElement.classList.toggle('dark',d);}catch(e){}})();",
          }}
        />
      </head>
      <body className="antialiased">
        <main className="h-dvh w-full">{children}</main>
      </body>
    </html>
  );
}
