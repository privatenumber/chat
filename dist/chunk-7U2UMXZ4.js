// src/format/index.ts
var CONTROL_PATTERN = /[<>|]/;
var DATE_CONTROL_PATTERN = /[\^|>]/;
var SLACK_ID_PATTERN = /^[A-Z0-9_]+$/;
var SLACK_USER_TOKEN_PATTERN = /(?<![<\w])@([A-Z][A-Z0-9_]+)/g;
var SPECIAL_MENTION_PATTERN = /^<!(here|channel|everyone)(?:\|[^<>]*)?>$/;
var LABELED_GROUP_PATTERN = /^<!subteam\^([A-Z0-9_]+)\|@?([^<>]+)>$/;
var GROUP_PATTERN = /^<!subteam\^([A-Z0-9_]+)>$/;
var TEXT_OBJECT_MAX_LENGTH = 3e3;
var CODE_FENCE = "```";
var LEADING_WHITESPACE_PATTERN = /^[ \t]+/;
var BLOCK_MARKER_PATTERN = /^(?:&gt;|&lt;|#{1,6}(?=[ \t\n]|$)|[-+*](?=[ \t\n]|$)|`{3,}|~{3,}|(?:[-*_][ \t]*){3,}(?=\n|$))/;
var ORDERED_LIST_MARKER_PATTERN = /^(\d{1,9})([.)])(?=[ \t\n]|$)/;
function escapeSlackText(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function unescapeSlackText(text) {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
function createSlackPlainText(text, options = {}) {
  assertSlackTextObjectText(text);
  return {
    ...options.emoji === void 0 ? {} : { emoji: options.emoji },
    text,
    type: "plain_text"
  };
}
function createSlackMrkdwn(text, options = {}) {
  assertSlackTextObjectText(text);
  return {
    text,
    type: "mrkdwn",
    ...options.verbatim === void 0 ? {} : { verbatim: options.verbatim }
  };
}
function formatSlackUser(userId) {
  assertSlackId(userId, "userId");
  return `<@${userId}>`;
}
function formatSlackChannel(channelId) {
  assertSlackId(channelId, "channelId");
  return `<#${channelId}>`;
}
function formatSlackUserGroup(userGroupId) {
  assertSlackId(userGroupId, "userGroupId");
  return `<!subteam^${userGroupId}>`;
}
function formatSlackSpecialMention(mention) {
  return `<!${mention}>`;
}
function formatSlackLink(url, label) {
  assertNoSlackControl(url, "url");
  return label ? `<${url}|${escapeSlackText(label)}>` : `<${url}>`;
}
function formatSlackDate(timestamp, token, fallback, options = {}) {
  assertNoSlackDateControl(token, "token");
  const seconds = timestamp instanceof Date ? Math.floor(timestamp.getTime() / 1e3) : timestamp;
  if (!Number.isInteger(seconds)) {
    throw new TypeError("timestamp must be an integer unix timestamp or Date");
  }
  const link = options.link ? `^${assertSlackDateLink(options.link)}` : "";
  return `<!date^${seconds}^${token}${link}|${escapeSlackText(fallback)}>`;
}
function slackMrkdwnToMarkdown(mrkdwn) {
  const markdown = mrkdwn.includes(CODE_FENCE) ? convertMrkdwnWithCodeFences(mrkdwn) : convertMrkdwnText(mrkdwn);
  return unescapeSlackText(markdown);
}
function convertSlackTokens(mrkdwn) {
  let markdown = mrkdwn.replace(/<@([A-Z0-9_]+)\|([^<>]+)>/g, "@$2");
  markdown = markdown.replace(/<@([A-Z0-9_]+)>/g, "@$1");
  markdown = markdown.replace(/<#([A-Z0-9_]+)\|([^<>]+)>/g, "#$2 ($1)");
  markdown = markdown.replace(/<#([A-Z0-9_]+)>/g, "#$1");
  markdown = markdown.replace(
    /<(?!https?:\/\/)([^<>|]+)\|(https?:\/\/[^|<>]+)>/g,
    "<$2|$1>"
  );
  markdown = markdown.replace(/<(https?:\/\/[^|<>]+)\|([^<>]+)>/g, "[$2]($1)");
  markdown = markdown.replace(/<(https?:\/\/[^<>]+)>/g, "$1");
  return markdown;
}
function convertMrkdwnText(mrkdwn) {
  let markdown = convertSlackTokens(convertSpecialMentions(mrkdwn));
  markdown = markdown.replace(/(?<![_*\\])\*([^*\n]+)\*(?![_*])/g, "**$1**");
  markdown = markdown.replace(/(?<!~)~([^~\n]+)~(?!~)/g, "~~$1~~");
  return markdown;
}
function convertSpecialMentions(mrkdwn) {
  let result = "";
  let start = 0;
  let cursor = 0;
  while (cursor < mrkdwn.length) {
    if (mrkdwn.startsWith(CODE_FENCE, cursor)) {
      cursor += CODE_FENCE.length;
      continue;
    }
    if (mrkdwn[cursor] === "`") {
      const end2 = findInlineCodeEnd(mrkdwn, cursor);
      cursor = end2 === -1 ? cursor + 1 : end2;
      continue;
    }
    if (mrkdwn[cursor] !== "<") {
      cursor += 1;
      continue;
    }
    const end = findAngleTokenEnd(mrkdwn, cursor);
    if (end === -1) {
      cursor += 1;
      continue;
    }
    const token = mrkdwn.slice(cursor, end).replace(SPECIAL_MENTION_PATTERN, "@$1").replace(LABELED_GROUP_PATTERN, "@$2").replace(GROUP_PATTERN, "@$1");
    result += mrkdwn.slice(start, cursor) + token;
    start = end;
    cursor = end;
  }
  return result + mrkdwn.slice(start);
}
function convertMrkdwnWithCodeFences(mrkdwn) {
  let result = "";
  let textStart = 0;
  let cursor = 0;
  let movedToOwnLine = false;
  const flushTextBefore = (end) => {
    let text = mrkdwn.slice(textStart, end);
    if (movedToOwnLine) {
      text = escapeLeadingBlockMarker(text);
      movedToOwnLine = false;
    }
    result += convertMrkdwnText(text);
  };
  while (cursor < mrkdwn.length) {
    const char = mrkdwn[cursor];
    if (char === "<") {
      const tokenEnd = findAngleTokenEnd(mrkdwn, cursor);
      cursor = tokenEnd === -1 ? cursor + 1 : tokenEnd;
      continue;
    }
    if (char !== "`") {
      cursor += 1;
      continue;
    }
    if (!mrkdwn.startsWith(CODE_FENCE, cursor)) {
      const spanEnd = findInlineCodeEnd(mrkdwn, cursor);
      cursor = spanEnd === -1 ? cursor + 1 : spanEnd;
      continue;
    }
    const contentStart = cursor + CODE_FENCE.length;
    const contentEnd = mrkdwn.indexOf(CODE_FENCE, contentStart);
    if (contentEnd === -1 || isOnBlockquoteLine(mrkdwn, cursor)) {
      cursor = contentStart;
      continue;
    }
    flushTextBefore(cursor);
    if (result.length > 0 && !result.endsWith("\n")) {
      result += "\n";
    }
    const content = mrkdwn.slice(contentStart, contentEnd);
    result += CODE_FENCE;
    if (!content.startsWith("\n")) {
      result += "\n";
    }
    result += convertSlackTokens(content);
    if (!content.endsWith("\n")) {
      result += "\n";
    }
    result += CODE_FENCE;
    cursor = contentEnd + CODE_FENCE.length;
    textStart = cursor;
    if (cursor < mrkdwn.length && mrkdwn[cursor] !== "\n") {
      result += "\n";
      movedToOwnLine = true;
    }
  }
  flushTextBefore(mrkdwn.length);
  return result;
}
function findAngleTokenEnd(mrkdwn, index) {
  let cursor = index + 1;
  while (cursor < mrkdwn.length && mrkdwn[cursor] !== ">" && mrkdwn[cursor] !== "\n" && mrkdwn[cursor] !== "\r") {
    cursor += 1;
  }
  return mrkdwn[cursor] === ">" ? cursor + 1 : -1;
}
function findInlineCodeEnd(mrkdwn, index) {
  const close = mrkdwn.indexOf("`", index + 1);
  if (close === -1) {
    return -1;
  }
  const newline = mrkdwn.indexOf("\n", index + 1);
  if (newline !== -1 && newline < close) {
    return -1;
  }
  return close + 1;
}
function isOnBlockquoteLine(mrkdwn, index) {
  const lineStart = mrkdwn.lastIndexOf("\n", index - 1) + 1;
  return mrkdwn.slice(lineStart, index).trimStart().startsWith("&gt;");
}
function escapeLeadingBlockMarker(text) {
  const whitespace = LEADING_WHITESPACE_PATTERN.exec(text)?.[0] ?? "";
  const prefix = whitespace.length > 0 ? " " : "";
  const rest = text.slice(whitespace.length);
  if (BLOCK_MARKER_PATTERN.test(rest)) {
    return `${prefix}\\${rest}`;
  }
  return prefix + rest.replace(ORDERED_LIST_MARKER_PATTERN, "$1\\$2");
}
function markdownBoldToSlackMrkdwn(markdown) {
  return markdown.replace(/\*\*(.+?)\*\*/g, "*$1*");
}
function linkBareSlackMentions(text) {
  return text.replace(SLACK_USER_TOKEN_PATTERN, "<@$1>");
}
function assertSlackTextObjectText(text) {
  if (text.length < 1 || text.length > TEXT_OBJECT_MAX_LENGTH) {
    throw new TypeError(
      `text must be between 1 and ${TEXT_OBJECT_MAX_LENGTH} characters`
    );
  }
}
function assertSlackId(value, name) {
  if (!SLACK_ID_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a Slack ID`);
  }
}
function assertNoSlackControl(value, name) {
  if (CONTROL_PATTERN.test(value)) {
    throw new TypeError(`${name} cannot contain Slack control characters`);
  }
}
function assertNoSlackDateControl(value, name) {
  if (DATE_CONTROL_PATTERN.test(value)) {
    throw new TypeError(`${name} cannot contain Slack date control characters`);
  }
}
function assertSlackDateLink(value) {
  assertNoSlackDateControl(value, "link");
  return value;
}

export {
  escapeSlackText,
  unescapeSlackText,
  createSlackPlainText,
  createSlackMrkdwn,
  formatSlackUser,
  formatSlackChannel,
  formatSlackUserGroup,
  formatSlackSpecialMention,
  formatSlackLink,
  formatSlackDate,
  slackMrkdwnToMarkdown,
  markdownBoldToSlackMrkdwn,
  linkBareSlackMentions
};
