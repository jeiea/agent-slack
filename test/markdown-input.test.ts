import { describe, expect, test } from "bun:test";
import { padFlankingDelimiters } from "../src/slack/markdown-input.ts";

const H = " ";

describe("padFlankingDelimiters", () => {
  test.each([
    ["**제목(A)**은", `**제목(A)**${H}은`],
    ["이것은**(A)제목** 끝", `이것은${H}**(A)제목** 끝`],
    ["**안내 ([화면](https://a.com/x))**를 확인", `**안내 ([화면](https://a.com/x))**${H}를 확인`],
    ["~~취소(A)~~됨, _기울임(B)_임", `~~취소(A)~~${H}됨, _기울임(B)_${H}임`],
  ])("pads a delimiter that Slack would not treat as emphasis: %p", (input, expected) => {
    expect(padFlankingDelimiters(input)).toBe(expected);
  });

  test.each([
    ["already valid opener after punctuation", "제목(A)**굵게**"],
    ["plain Korean emphasis", "**제목**은"],
    ["intraword underscores", "snake_case_name and :white_check_mark:"],
    ["arithmetic asterisks", "2*3*4 = 24, 5 * 3 * 2"],
    ["list bullets", "* 항목(A)\n* 항목(B)"],
    ["unpaired delimiter", "그리고 닫힌(B)**은"],
    ["escaped delimiters", "\\*\\*제목(A)\\*\\*은"],
    ["inline code", "`**제목(A)**은`"],
    ["multi-backtick code span", "``**제목(A)**은``"],
    ["fenced code", "```\n**제목(A)**은\n```"],
    ["tilde fenced code", "~~~\n**제목(A)**은\n~~~"],
    ["indented code", "    **제목(A)**은"],
    ["link destination", "[a](https://a.com/**(b)**c)"],
    ["link destination with parentheses", "[문서](https://example.com/(v1)/**(x)**y)"],
    ["bare URL", "https://a.com/foo_(bar)_baz"],
    ["Slack token", "<https://a.com/_(x)_y|label>"],
  ])("leaves %s unchanged", (_name, input) => {
    expect(padFlankingDelimiters(input)).toBe(input);
  });

  test("pairs delimiters within a line, not across lines", () => {
    expect(padFlankingDelimiters("**열린(A)\n닫힌(B)**은")).toBe("**열린(A)\n닫힌(B)**은");
    expect(padFlankingDelimiters("**열린(A) ```a\nb``` 닫힌(B)**은")).toBe(
      "**열린(A) ```a\nb``` 닫힌(B)**은",
    );
  });
});
