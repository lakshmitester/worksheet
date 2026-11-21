import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import { signOut } from "./(auth)/actions";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Worksheet",
  description:
    "Branded English worksheets and live assessments for tuition centers",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getUser();

  return (
    <html lang="en-GB">
      <body
        className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col bg-neutral-50 font-sans text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100`}
      >
        <header className="border-b border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900">
          <div className="mx-auto flex h-14 w-full max-w-4xl items-center justify-between px-4">
            <Link
              href={user ? "/dashboard" : "/"}
              className="font-semibold tracking-tight"
            >
              Worksheet
            </Link>
            {user ? (
              <div className="flex items-center gap-3 text-sm">
                <span className="hidden text-neutral-500 sm:inline">
                  {user.email}
                </span>
                <form action={signOut}>
                  <button
                    type="submit"
                    className="font-medium text-indigo-600 hover:underline"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            ) : (
              <nav className="flex items-center gap-4 text-sm">
                <Link href="/login" className="font-medium hover:underline">
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700"
                >
                  Get started
                </Link>
              </nav>
            )}
          </div>
        </header>
        <main className="flex flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
