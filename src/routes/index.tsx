import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app/AppShell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Noteurbrain" },
      {
        name: "description",
        content:
          "A local-first, privacy-focused second brain. Markdown notes, bi-directional links, and graph view — stored in your browser with SQLite.",
      },
      { property: "og:title", content: "Second Brain" },
      {
        property: "og:description",
        content: "Local-first Markdown notes powered by SQLite Wasm in your browser.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  // SQLite Wasm + OPFS is browser-only; avoid SSR hydration of the worker
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-sm text-muted-foreground">
        Initializing local database…
      </div>
    );
  }
  return <AppShell />;
}
