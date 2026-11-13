// Draft editor text <-> HTML conversion. draft-server.ts inlines this file into
// draft-editor.html's script, so it stays a plain browser script without
// imports or exports; tests evaluate it against a DOM implementation.
/* eslint-disable no-unused-vars -- the editor script calls these after inlining */

/**
 * Source syntax per dialect: Slack mrkdwn, or standard Markdown that Slack
 * converts from `markdown_text`. Constructs the editor has no element for
 * (tables, headings) stay as text in either dialect.
 */
const DIALECTS = {
  mrkdwn: {
    bold: "*",
    italic: "_",
    strike: "~",
    bullet: "•",
    link: (href, text) => `<${href}|${text}>`,
    // \x00 marks a code placeholder; a URL holding one is left as text.
    linkPattern: /<(https?:\/\/[^|>\x00]+)(?:\|([^>]+))?>/g,
    readLink: (url, label) => [url, label],
    emphasis: [
      [/\*([^*]+)\*/g, "<b>$1</b>"],
      [/(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/g, "<i>$1</i>"],
      [/~([^~]+)~/g, "<s>$1</s>"],
    ],
    escapeText: false,
  },
  markdown: {
    bold: "**",
    italic: "_",
    strike: "~~",
    bullet: "-",
    link: (href, text) => `[${text}](${href})`,
    // Destinations may hold one level of balanced parentheses, as in Wikipedia URLs.
    linkPattern: /\[([^\]]+)\]\(((?:https?:\/\/|mailto:)(?:[^()\s\x00]|\([^()\s\x00]*\))+)\)/g,
    readLink: (label, url) => [url, label],
    emphasis: [
      [/\*\*((?:[^*]|\*(?!\*))+)\*\*|__((?:[^_]|_(?!_))+)__/g, "<b>$1$2</b>"],
      [/\*([^*]+)\*|(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/g, "<i>$1$2</i>"],
      [/~~([^~]+)~~/g, "<s>$1</s>"],
    ],
    // Slack tokens such as `<@U123>` must show as text, not parse as tags.
    escapeText: true,
  },
};

// ─── Source text to HTML (initial content, leaving source mode) ───
function sourceToHtml(text, dialectName) {
  if (!text) {
    return "";
  }
  const dialect = DIALECTS[dialectName];
  const fmtInline = (t) => formatInline(t, dialect);
  const codeBlocks = [];
  text = text.replace(/```(?:([^\s`]+)\n)?([\s\S]*?)```/g, (_, lang, code) => {
    const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : "";
    codeBlocks.push(`<pre${langAttr}>${escapeHtml(code.trim())}</pre>`);
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });
  const inlineCodes = [];
  text = text.replace(/`([^`\n]+)`/g, (_, code) => {
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00IC${inlineCodes.length - 1}\x00`;
  });

  const lines = text.split("\n");
  let html = "",
    idx = 0;
  while (idx < lines.length) {
    const line = lines[idx];
    if (line.startsWith("> ")) {
      const q = [];
      while (idx < lines.length && lines[idx].startsWith("> ")) {
        q.push(fmtInline(lines[idx].slice(2)));
        idx++;
      }
      html += `<blockquote>${q.join("<br>")}</blockquote>`;
      continue;
    }
    if (/^[•\-*] /.test(line)) {
      const items = [];
      while (idx < lines.length && /^[•\-*] /.test(lines[idx])) {
        items.push(`<li>${fmtInline(lines[idx].replace(/^[•\-*] /, ""))}</li>`);
        idx++;
      }
      html += `<ul>${items.join("")}</ul>`;
      continue;
    }
    if (/^\d+[.)] /.test(line)) {
      const items = [];
      while (idx < lines.length && /^\d+[.)] /.test(lines[idx])) {
        items.push(`<li>${fmtInline(lines[idx].replace(/^\d+[.)] /, ""))}</li>`);
        idx++;
      }
      html += `<ol>${items.join("")}</ol>`;
      continue;
    }
    html += `${line ? fmtInline(line) : ""}<br>`;
    idx++;
  }
  codeBlocks.forEach((b, i) => {
    html = html.replace(`\x00CB${i}\x00`, b);
  });
  inlineCodes.forEach((c, i) => {
    html = html.replace(`\x00IC${i}\x00`, c);
  });
  return html.replace(/(<br>)+$/, "");
}

// ─── HTML to source text (submission, entering source mode) ───
function htmlToSource(root, dialectName) {
  const dialect = DIALECTS[dialectName];
  const visited = new Set();
  function walk(node) {
    if (visited.has(node)) {
      return "";
    }
    if (node.nodeType === 3) {
      return node.textContent || "";
    }
    if (node.nodeType !== 1) {
      return "";
    }
    const el = node;
    const tag = el.tagName.toLowerCase();
    const kids = () => Array.from(el.childNodes).map(walk).join("");
    switch (tag) {
      case "b":
      case "strong":
        return wrapMarker(kids(), dialect.bold);
      case "i":
      case "em":
        return wrapMarker(kids(), dialect.italic);
      case "s":
      case "strike":
      case "del":
        return wrapMarker(kids(), dialect.strike);
      case "code":
        return `\`${el.textContent || ""}\``;
      case "pre": {
        const pres = adjacentPres(el);
        pres.forEach((pre) => visited.add(pre));
        const lines = pres.map((pre) => (pre.textContent || "").trimEnd()).filter((l) => l);
        const lang = el.getAttribute("data-lang") || "";
        return `\`\`\`${lang}\n${lines.join("\n")}\n\`\`\`\n`;
      }
      case "blockquote": {
        const c = kids().trim();
        return `${c
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n")}\n`;
      }
      case "ul": {
        let r = "";
        for (const li of listItems(el)) {
          r += `${dialect.bullet} ${walk(li).trim()}\n`;
        }
        return r;
      }
      case "ol": {
        let r = "",
          n = 1;
        for (const li of listItems(el)) {
          r += `${n}. ${walk(li).trim()}\n`;
          n++;
        }
        return r;
      }
      case "li":
        return kids();
      case "a": {
        const h = el.getAttribute("href");
        const t = kids();
        return h && t && h !== t ? dialect.link(h, t) : h || t;
      }
      case "br":
        return "\n";
      case "div":
      case "p": {
        const c = kids();
        const p = el.parentElement;
        if (p && ["li", "blockquote", "td"].includes(p.tagName.toLowerCase())) {
          return c;
        }
        return c.endsWith("\n") ? c : `${c}\n`;
      }
      case "span": {
        const st = el.style;
        let c = kids();
        if (st.fontWeight === "bold" || Number(st.fontWeight) >= 700) {
          c = wrapMarker(c, dialect.bold);
        }
        if (st.fontStyle === "italic") {
          c = wrapMarker(c, dialect.italic);
        }
        if (st.textDecoration && st.textDecoration.includes("line-through")) {
          c = wrapMarker(c, dialect.strike);
        }
        return c;
      }
      default:
        return kids();
    }
  }
  return walk(root)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(t) {
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Links are set aside before emphasis so markers inside a URL stay in the
 * href, and the href is attribute-escaped so no text can add attributes.
 */
function formatInline(text, dialect) {
  const source = dialect.escapeText ? escapeHtml(text) : text;
  const links = [];
  const withoutLinks = source.replace(dialect.linkPattern, (_, first, second) => {
    const [href, label] = dialect.readLink(first, second);
    const attr = dialect.escapeText ? href : escapeHtml(href);
    const shown = label === undefined ? attr : applyEmphasis(label, dialect);
    links.push(`<a href="${attr}" target="_blank">${shown}</a>`);
    return `\x00LK${links.length - 1}\x00`;
  });
  return applyEmphasis(withoutLinks, dialect).replace(/\x00LK(\d+)\x00/g, (_, i) => links[i]);
}

function applyEmphasis(text, dialect) {
  return dialect.emphasis.reduce(
    (t, [pattern, replacement]) => t.replace(pattern, replacement),
    text,
  );
}

function wrapMarker(content, marker) {
  return content.trim() ? `${marker}${content}${marker}` : content;
}

function listItems(list) {
  return Array.from(list.children).filter((child) => child.tagName === "LI");
}

/** The browser splits <pre> on Enter, so sibling pres are one code block. */
function adjacentPres(pre) {
  const pres = [pre];
  let next = pre.nextElementSibling;
  while (next && next.tagName === "PRE") {
    pres.push(next);
    next = next.nextElementSibling;
  }
  return pres;
}
