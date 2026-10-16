// src/file.ts
var origins = /* @__PURE__ */ new Set([
  "https://files.slack.com",
  "https://files.slack-gov.com",
  "https://slack-files.com",
  "https://slack-files-gov.com",
  "https://slack.com",
  "https://slack-gov.com"
]);
function isSlackAuthUrl(url, apiUrl) {
  try {
    const origin = new URL(url).origin;
    return origins.has(origin) || apiUrl !== void 0 && origin === new URL(apiUrl).origin;
  } catch {
    return false;
  }
}

export {
  isSlackAuthUrl
};
