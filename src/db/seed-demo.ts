/**
 * Demo: 1 notebook, 2 sections, 5 pages.
 * Mention syntax (no brackets):
 *   @Title                          — same section
 *   @Section/Title                  — different section, same notebook
 *   @Notebook/Section/Title         — different notebook
 */
export interface DemoSection {
  name: string;
  color: string;
  pages: { title: string; content: string }[];
}

export interface DemoNotebook {
  name: string;
  color: string;
  sections: DemoSection[];
}

export const DEMO_NOTEBOOK: DemoNotebook = {
  name: "My Second Brain",
  color: "#7c3aed",
  sections: [
    {
      name: "Concepts",
      color: "#f59e0b",
      pages: [
        {
          title: "Index",
          content: `# Index — Your Second Brain

Welcome. This is a tiny demo of how the app works.

## Map of Content
- @Local-First Philosophy
- @How Linking Works
- @Features/Graph View
- @Features/Sync Concept

## Try it
1. Open any mention above.
2. Type @ anywhere in the editor to open the page picker.
3. Switch to **Graph** at the top to see all pages connected.
4. Scroll to the bottom of any page to see **Backlinks**.

#start-here #moc`,
        },
        {
          title: "Local-First Philosophy",
          content: `# Local-First Philosophy

All pages live on **your device** in a SQLite database running inside
the browser (via OPFS). No server round-trip to read or write.

Benefits:
- Instant reads & writes, even offline
- Your data is yours — see @Features/Sync Concept
- Works in any modern browser

Related: @Index

#philosophy #architecture`,
        },
        {
          title: "How Linking Works",
          content: `# How Linking Works

Type \`@\` to open the picker, then choose a page. The picker inserts
the minimal path needed to reach it:

- Same section: just \`@Title\`
- Same notebook, different section: \`@Section/Title\`
- Different notebook: \`@Notebook/Section/Title\`

Examples used in this demo:
- @Index (same section)
- @Features/Graph View (cross-section)
- @My Second Brain/Features/Sync Concept (fully qualified)

Tags use \`#like-this\` and group pages across the vault.

#syntax #tutorial`,
        },
      ],
    },
    {
      name: "Features",
      color: "#ec4899",
      pages: [
        {
          title: "Graph View",
          content: `# Graph View

Renders every page as a **node** and every resolved @mention as an
**edge**. Node size scales with the number of connections.

See: @Concepts/How Linking Works · @Concepts/Index

#feature #visualization`,
        },
        {
          title: "Sync Concept",
          content: `# Sync Concept

The app is **local-first**, but you can export/import the database to
move it between machines.

Today:
1. Export the entire SQLite file from the toolbar.
2. Open the app on another PC and use Import to restore.

Planned: background cloud sync with Lamport-clock conflict resolution.

Related: @Concepts/Local-First Philosophy · @Concepts/Index

#roadmap #sync`,
        },
      ],
    },
  ],
};
