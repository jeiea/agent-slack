/** Shared help so every command that takes `--markdown` states the same contract. */
export const MARKDOWN_OPTION_HELP =
  "Send text as standard Markdown that Slack converts (**bold**, *italic*, ~~strike~~, [label](url), headings, tables). Text goes out as written: bare @U... and @here are not converted to mentions; write <@U...>.";

export const CJK_SPACING_OPTION_HELP =
  "With --markdown, skip the hair space (U+200A) inserted between an emphasis marker and an adjacent letter when punctuation is on its other side, e.g. **제목(A)**은 or 이것은**(A)제목**, which Slack otherwise leaves literal.";
