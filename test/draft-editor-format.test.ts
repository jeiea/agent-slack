import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
// @ts-ignore — the package declares an ambient "domino" module instead of its own name
import domino from "@mixmark-io/domino";
import { buildEditorHtml } from "../src/cli/draft-server.ts";

type Dialect = "mrkdwn" | "markdown";
type EditorNode = {
  querySelectorAll: (selector: string) => unknown;
  innerHTML: string;
  querySelector: (selector: string) => EditorNode | null;
  getAttribute: (name: string) => string | null;
};
type Format = {
  sourceToHtml: (text: string, dialect: Dialect) => string;
  htmlToSource: (root: EditorNode, dialect: Dialect) => string;
};

const formatScript = readFileSync(
  new URL("../src/cli/draft-editor-format.js", import.meta.url),
  "utf8",
);
const format = new Function(`${formatScript}\nreturn { sourceToHtml, htmlToSource };`)() as Format;

function loadEditor(text: string, dialect: Dialect): EditorNode {
  const editor = domino.createDocument('<div id="editor"></div>').getElementById("editor");
  editor.innerHTML = format.sourceToHtml(text, dialect);
  return editor;
}

function attributeNames(root: EditorNode): string[] {
  const elements = root.querySelectorAll("*") as Iterable<{
    attributes: Iterable<{ name: string }>;
  }>;
  return Array.from(elements).flatMap((el) => Array.from(el.attributes, (attr) => attr.name));
}

/** Load text into the editor and serialize it back, as source-mode toggles and sends do. */
function roundTrip(text: string, dialect: Dialect): string {
  return format.htmlToSource(loadEditor(text, dialect), dialect);
}

describe("draft editor mrkdwn", () => {
  test.each([
    "*굵게* _기울임_ ~취소~ `코드` <https://a.com|링크> <@U012AB3CD>",
    "<https://a.com/x?y=1&z=2|쿼리>",
    "• 하나\n• 둘",
    "1. 하나\n2. 둘",
    "> 인용 *굵게*",
    "```\nconst a = 1;\n```",
    "첫 줄\n둘째 줄",
  ])("keeps %p through the editor", (text) => {
    expect(roundTrip(text, "mrkdwn")).toBe(text);
  });

  test("normalizes hyphen bullets to Slack bullets", () => {
    expect(roundTrip("- 하나\n- 둘", "mrkdwn")).toBe("• 하나\n• 둘");
  });

  test("sends a bare link as its URL, underscores included", () => {
    expect(roundTrip("<https://a.com/a_b_c>", "mrkdwn")).toBe("https://a.com/a_b_c");
  });
});

describe("draft editor standard Markdown", () => {
  test.each([
    "**굵게** _기울임_ ~~취소~~ `코드` [링크](https://a.com)",
    "**안내 ([화면](https://a.com/x))**를 확인",
    "- 하나\n- 둘",
    "1. 하나\n2. 둘",
    "> 인용 **굵게**",
    "```\nconst a = 1;\n```",
    "```js\nconst a = 1;\n```",
    "<@U012AB3CD> a & b < c",
    "# 제목\n| A | B |\n|---|---|\n| 1 | 2 |",
  ])("keeps %p through the editor", (text) => {
    expect(roundTrip(text, "markdown")).toBe(text);
  });

  test("normalizes alternative markers to one style", () => {
    expect(roundTrip("__굵게__ *기울임*\n* 하나", "markdown")).toBe("**굵게** _기울임_\n- 하나");
    expect(roundTrip("**굵게 *기울임* 굵게**", "markdown")).toBe("**굵게 _기울임_ 굵게**");
  });

  test("shows a bold link as a link inside bold", () => {
    const editor = loadEditor("**안내 ([화면](https://a.com/x))**", "markdown");
    expect(editor.querySelector("b a")?.innerHTML).toBe("화면");
  });

  test.each([
    'https://a.com/?q="y"onclick=z',
    "https://a.com/__path__/",
    "https://en.wikipedia.org/wiki/Function_(mathematics)",
  ])("links to %p as written", (url) => {
    const editor = loadEditor(`[x](${url})`, "markdown");
    expect(editor.querySelector("a")?.getAttribute("href")).toBe(url);
    expect(format.htmlToSource(editor, "markdown")).toBe(`[x](${url})`);
  });

  test.each([
    ["markdown", '[x](https://a/`"onmouseover="alert(1)//`)'],
    ["mrkdwn", '<https://a/`"onmouseover="alert(1)//`|x>'],
  ] as const)("%s code in a link URL cannot add event handlers", (dialect, text) => {
    expect(attributeNames(loadEditor(text, dialect))).not.toContain("onmouseover");
  });

  test("keeps code in a link URL as written", () => {
    const text = '[x](https://a/`"onmouseover="alert(1)//`)';
    expect(roundTrip(text, "markdown")).toBe(text);
  });
});

describe("draft editor page", () => {
  test("a --markdown compose page edits with the tested Markdown converter", () => {
    const html = buildEditorHtml({
      channelName: "general",
      markdown: true,
      onSend: async () => ({ ts: "1" }),
    });
    expect(html, "the page runs the converter tested above").toContain(formatScript.trim());
    expect(html, "the page picks the Markdown dialect").toContain('"markdown":true');
  });
});
