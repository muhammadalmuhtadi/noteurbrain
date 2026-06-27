import { createServerFn } from "@tanstack/react-start";

export const clipWebpage = createServerFn({ method: "GET" })
  .validator((url: string) => {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      throw new Error("Invalid URL protocol. Must start with http:// or https://");
    }
    return url;
  })
  .handler(async ({ data: url }) => {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.statusText}`);
      }
      const html = await response.text();

      // Extract Title
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      let title = titleMatch ? titleMatch[1].trim() : "Clipped Page";
      title = decodeHtmlEntities(title);

      // Clean HTML body
      let bodyHtml = html;
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (bodyMatch) {
        bodyHtml = bodyMatch[1];
      }

      // Strip script, style, nav, header, footer
      bodyHtml = bodyHtml
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<nav[\s\S]*?<\/nav>/gi, "")
        .replace(/<header[\s\S]*?<\/header>/gi, "")
        .replace(/<footer[\s\S]*?<\/footer>/gi, "")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
        .replace(/<!--[\s\S]*?-->/g, "");

      // Convert clean HTML to markdown
      let markdown = htmlToMarkdown(bodyHtml);

      // Prepend metadata header
      const dateStr = new Date().toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const metaHeader = `Source: [${url}](${url})\nClipped: ${dateStr}\n\n---\n\n`;
      markdown = metaHeader + markdown;

      return { title, markdown };
    } catch (error) {
      console.error("Web Clipper error:", error);
      throw new Error((error as Error).message);
    }
  });

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—");
}

function htmlToMarkdown(html: string): string {
  let h = html;

  // Convert headings
  h = h.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, levelNum, inner) => {
    const level = parseInt(levelNum, 10);
    const text = stripInlineTags(inner).trim();
    return `\n\n${"#".repeat(level)} ${text}\n\n`;
  });

  // Convert tables
  h = h.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tbody) => {
    const rows: string[][] = [];
    const rowMatches = tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    for (const row of rowMatches) {
      const cells: string[] = [];
      const cellMatches = row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi);
      for (const cell of cellMatches) {
        cells.push(stripInlineTags(cell[1]).trim().replace(/\|/g, "\\|"));
      }
      rows.push(cells);
    }
    if (rows.length === 0) return "";
    const maxCols = Math.max(...rows.map((r) => r.length));
    const pad = (r: string[]) => {
      while (r.length < maxCols) r.push("");
      return r;
    };
    const header = `| ${pad(rows[0]).join(" | ")} |`;
    const sep = `| ${Array(maxCols).fill("---").join(" | ")} |`;
    const body = rows
      .slice(1)
      .map((r) => `| ${pad(r).join(" | ")} |`)
      .join("\n");
    return `\n\n${header}\n${sep}\n${body}\n\n`;
  });

  // Inline formatting
  h = h
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/(strong|b)>/gi, "**$2**")
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/(em|i)>/gi, "*$2*")
    .replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, "<u>$1</u>")
    .replace(/<s[^>]*>([\s\S]*?)<\/s>/gi, "~~$1~~")
    .replace(/<strike[^>]*>([\s\S]*?)<\/strike>/gi, "~~$1~~")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => "\n\n```\n" + c.replace(/<[^>]+>/g, "") + "\n```\n\n");

  // Links
  h = h.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const t = stripInlineTags(text).trim();
    if (!t) return "";
    return `[${t}](${href})`;
  });

  // Paragraphs / Breaks
  h = h
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(div|section|article|main|li|ol|ul|span)[^>]*>/gi, "\n");

  // Strip remaining tags
  h = h.replace(/<[^>]+>/g, "");

  // Decode entities
  h = decodeHtmlEntities(h);

  // Normalize spaces
  h = h
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return h;
}

function stripInlineTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}
