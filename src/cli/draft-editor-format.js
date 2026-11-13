// Draft editor text <-> HTML conversion. draft-server.ts inlines this file into
// draft-editor.html's script, so it stays a plain browser script without
// imports or exports; tests evaluate it against a DOM implementation.
/* eslint-disable no-unused-vars -- the editor script calls these after inlining */

// ─── mrkdwn to HTML (initial content) ───
function mrkdwnToHtml(text) {
  if (!text) {
    return "";
  }
  const codeBlocks = [];
  text = text.replace(/```([\s\S]*?)```/g, (_, code) => {
    codeBlocks.push(`<pre>${escapeHtml(code.trim())}</pre>`);
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

function escapeHtml(t) {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtInline(t) {
  t = t.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '<a href="$1" target="_blank">$2</a>');
  t = t.replace(/<(https?:\/\/[^>]+)>/g, '<a href="$1" target="_blank">$1</a>');
  t = t.replace(/\*([^*]+)\*/g, "<b>$1</b>");
  t = t.replace(/(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/g, "<i>$1</i>");
  t = t.replace(/~([^~]+)~/g, "<s>$1</s>");
  return t;
}

// ─── HTML to mrkdwn (submission) ───
function htmlToMrkdwn(root) {
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
        return wrapMarker(kids(), "*");
      case "i":
      case "em":
        return wrapMarker(kids(), "_");
      case "s":
      case "strike":
      case "del":
        return wrapMarker(kids(), "~");
      case "code":
        return `\`${el.textContent || ""}\``;
      case "pre": {
        // Collect adjacent pres into one code block
        const lines = [(el.textContent || "").trimEnd()];
        let next = el.nextElementSibling;
        while (next && next.tagName === "PRE") {
          lines.push((next.textContent || "").trimEnd());
          visited.add(next);
          next = next.nextElementSibling;
        }
        return `\`\`\`\n${lines.filter((l) => l).join("\n")}\n\`\`\`\n`;
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
          r += `• ${walk(li).trim()}\n`;
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
        return h && t && h !== t ? `<${h}|${t}>` : h || t;
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
          c = wrapMarker(c, "*");
        }
        if (st.fontStyle === "italic") {
          c = wrapMarker(c, "_");
        }
        if (st.textDecoration && st.textDecoration.includes("line-through")) {
          c = wrapMarker(c, "~");
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

function wrapMarker(content, marker) {
  return content.trim() ? `${marker}${content}${marker}` : content;
}

function listItems(list) {
  return Array.from(list.children).filter((child) => child.tagName === "LI");
}
