import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { appName } from "@/lib/constants";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { themeStorageKey } from "@/lib/theme";

export const metadata: Metadata = {
  title: appName,
  description: "Private, geschützte Buchhaltungs-App für ein Kleingewerbe mit EÜR-Fokus."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var key = ${JSON.stringify(themeStorageKey)};
                  var mode = localStorage.getItem(key) || "system";
                  var isDark = mode === "dunkel" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
                  document.documentElement.classList.toggle("dark", isDark);
                  document.documentElement.dataset.themeMode = mode;
                } catch (error) {}
              })();
            `
          }}
        />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
