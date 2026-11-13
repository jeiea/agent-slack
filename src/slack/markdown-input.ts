/**
 * Standard Markdown input for `--markdown`: Slack's server converts it
 * (`markdown_text` / `markdown` block) using CommonMark emphasis rules.
 */

/**
 * U+200A is Unicode whitespace (Zs), so CommonMark treats it as a word
 * boundary. Zero-width space (U+200B) and word joiner (U+2060) are format
 * characters that count as letters, and Slack ignored them in live tests.
 */
const HAIR_SPACE = "\u200A";

/**
 * Text whose delimiters are not emphasis: fenced code (``` or ~~~, open to the
 * end when unclosed), indented code, code spans of any backtick length, link
 * destinations with one level of balanced parentheses, `<...>` tokens and
 * bare URLs.
 */
const PROTECTED_RE = new RegExp(
  [
    String.raw`^ {0,3}(\`{3,}|~{3,})[^\n]*(?:\n[\s\S]*?(?:\n {0,3}\1[\`~]*[ \t]*(?=\n|$)|$(?![\s\S])))?`,
    String.raw`^(?: {4}|\t)[^\n]*`,
    String.raw`(\`+)(?!\`)[\s\S]*?[^\`]\2(?!\`)`,
    String.raw`\]\((?:[^()\s]|\([^()\s]*\))*\)`,
    String.raw`<[^>\s]+>`,
    String.raw`(?:https?|mailto):[^\s<>]*`,
  ].join("|"),
  "gm",
);
const DELIMITER_CHARS = new Set(["*", "_", "~"]);

export type MarkdownInputOptions = { markdown?: boolean; cjkSpacing?: boolean };

type CharClass = "space" | "punct" | "other";

type DelimiterRun = {
  start: number;
  end: number;
  key: string;
  before: CharClass;
  after: CharClass;
};

/**
 * Text to hand to Slack as standard Markdown, or `undefined` when the caller
 * keeps the mrkdwn path. The text is otherwise sent as written: mrkdwn-only
 * rewrites such as promoting bare `@U...` / `@here` are not applied.
 */
export function resolveMarkdownText(
  text: string,
  options: MarkdownInputOptions & { blocks?: string },
): string | undefined {
  if (!options.markdown) {
    return undefined;
  }
  if (options.blocks !== undefined) {
    throw new Error("--markdown cannot be combined with --blocks.");
  }
  return options.cjkSpacing === false ? text : padFlankingDelimiters(text);
}

/** Blocks that Slack converts from standard Markdown on its side. */
export function markdownBlocks(text: string): unknown[] {
  return [{ type: "markdown", text }];
}

/**
 * CommonMark ignores an emphasis delimiter that touches punctuation on its
 * inner side and a letter on its outer side, e.g. `**제목(A)**은`. Korean
 * particles attach directly to words, so this is common. Insert a hair space
 * on the outer side of such delimiters so Slack renders the emphasis.
 *
 * Delimiters are paired in order per line and per run (`**` with `**`), so an
 * opener that already works, unpaired runs, code, link destinations, URLs and
 * `<...>` tokens are left alone.
 */
export function padFlankingDelimiters(text: string): string {
  const inserts = findDelimiterRunsByLine(text).flatMap(paddingPositions);
  return insertHairSpaces(text, inserts);
}

function findDelimiterRunsByLine(text: string): DelimiterRun[][] {
  const protectedEnds = protectedRanges(text);
  const lines: DelimiterRun[][] = [[]];
  let index = 0;
  while (index < text.length) {
    const protectedEnd = protectedEnds.get(index);
    if (protectedEnd !== undefined) {
      if (text.slice(index, protectedEnd).includes("\n")) {
        lines.push([]);
      }
      index = protectedEnd;
      continue;
    }
    const char = text[index]!;
    if (char === "\n") {
      lines.push([]);
      index++;
      continue;
    }
    if (!DELIMITER_CHARS.has(char) || text[index - 1] === "\\") {
      index++;
      continue;
    }
    const run = readDelimiterRun(text, { start: index, protectedEnds });
    if (canDelimit(run)) {
      lines.at(-1)!.push(run);
    }
    index = run.end;
  }
  return lines;
}

function readDelimiterRun(
  text: string,
  input: { start: number; protectedEnds: Map<number, number> },
): DelimiterRun {
  const char = text[input.start]!;
  let end = input.start + 1;
  while (text[end] === char && !input.protectedEnds.has(end)) {
    end++;
  }
  return {
    start: input.start,
    end,
    key: char.repeat(end - input.start),
    before: classify(text[input.start - 1]),
    after: classify(text[end]),
  };
}

function protectedRanges(text: string): Map<number, number> {
  const ranges = new Map<number, number>();
  for (const match of text.matchAll(PROTECTED_RE)) {
    ranges.set(match.index, match.index + match[0].length);
  }
  return ranges;
}

function classify(char: string | undefined): CharClass {
  if (char === undefined || /\s/u.test(char)) {
    return "space";
  }
  return /[\p{P}\p{S}]/u.test(char) ? "punct" : "other";
}

/** Runs CommonMark can never use: surrounded by spaces, or intraword `_`. */
function canDelimit(run: DelimiterRun): boolean {
  if (run.before === "space" && run.after === "space") {
    return false;
  }
  return !(run.key.startsWith("_") && run.before === "other" && run.after === "other");
}

function paddingPositions(runs: DelimiterRun[]): number[] {
  const positions: number[] = [];
  const openers = new Map<string, DelimiterRun>();
  for (const run of runs) {
    const opener = openers.get(run.key);
    if (!opener) {
      openers.set(run.key, run);
      continue;
    }
    openers.delete(run.key);
    if (opener.before === "other" && opener.after === "punct") {
      positions.push(opener.start);
    }
    if (run.before === "punct" && run.after === "other") {
      positions.push(run.end);
    }
  }
  return positions;
}

function insertHairSpaces(text: string, positions: number[]): string {
  let result = text;
  for (const position of [...positions].sort((a, b) => b - a)) {
    result = result.slice(0, position) + HAIR_SPACE + result.slice(position);
  }
  return result;
}
