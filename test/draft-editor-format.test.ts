import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
// @ts-ignore — the package declares an ambient "domino" module instead of its own name
import domino from "@mixmark-io/domino";
import { getEditorHtml } from "../src/cli/draft-server.ts";

type EditorNode = { innerHTML: string };
type Format = {
  mrkdwnToHtml: (text: string) => string;
  htmlToMrkdwn: (root: EditorNode) => string;
};

const formatScript = readFileSync(
  new URL("../src/cli/draft-editor-format.js", import.meta.url),
  "utf8",
);
const format = new Function(`${formatScript}\nreturn { mrkdwnToHtml, htmlToMrkdwn };`)() as Format;

/** Load text into the editor and serialize it back, as source-mode toggles and sends do. */
function roundTrip(text: string): string {
  const editor = domino.createDocument('<div id="editor"></div>').getElementById("editor");
  editor.innerHTML = format.mrkdwnToHtml(text);
  return format.htmlToMrkdwn(editor);
}

describe("draft editor mrkdwn", () => {
  test.each([
    "*굵게* _기울임_ ~취소~ `코드` <https://a.com|링크> <@U012AB3CD>",
    "• 하나\n• 둘",
    "1. 하나\n2. 둘",
    "> 인용 *굵게*",
    "```\nconst a = 1;\n```",
    "첫 줄\n둘째 줄",
  ])("keeps %p through the editor", (text) => {
    expect(roundTrip(text)).toBe(text);
  });

  test("normalizes hyphen bullets to Slack bullets", () => {
    expect(roundTrip("- 하나\n- 둘")).toBe("• 하나\n• 둘");
  });

  test("the served editor page carries the format script", () => {
    const html = getEditorHtml();
    expect(html).toContain("function mrkdwnToHtml(");
    expect(html).not.toContain("__DRAFT_FORMAT__");
  });
});
