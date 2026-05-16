import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Allo Inventory",
  description: "Multi-warehouse inventory reservation demo",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
            <a href="/" className="text-xl font-bold tracking-tight text-indigo-600">Allo</a>
            <span className="text-gray-300">|</span>
            <span className="text-sm text-gray-500">Inventory Demo</span>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
