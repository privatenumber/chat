import { readFile } from "node:fs/promises";
import { mockLogger } from "@chat-adapter/tests";
import { describe, expect, it } from "vitest";
import { createSlackAdapter, type SlackEvent } from "./index";
import { isSlackBotMention, parseSlackWebhookBody } from "./webhook";

const BODY_PATTERN = /body: '((?:[^'\\]|\\.)*)'/g;
const BOT_USER_ID = "U00FAKEBOT01";

/** The `body` strings logged in sample-messages.md, as raw webhook bodies. */
async function sampleBodies(): Promise<string[]> {
  const markdown = await readFile(
    new URL("../sample-messages.md", import.meta.url),
    { encoding: "utf8" }
  );
  return Array.from(markdown.matchAll(BODY_PATTERN), ([, literal]) =>
    JSON.parse(`"${literal.replace(/\\'/g, "'").replace(/(?<!\\)"/g, '\\"')}"`)
  );
}

describe("isSlackBotMention", () => {
  it("classifies captured app_mention payloads like message.isMention", async () => {
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      signingSecret: "test-signing-secret",
      logger: mockLogger,
      botUserId: BOT_USER_ID,
    });
    const results: { text: string; isMention: boolean }[] = [];

    for (const body of await sampleBodies()) {
      const payload = parseSlackWebhookBody(body, {
        contentType: "application/json",
      });
      if (payload.kind !== "app_mention") {
        continue;
      }
      const isMention = isSlackBotMention(payload.raw, BOT_USER_ID);
      expect(isMention).toBe(
        adapter.parseMessage(payload.raw as unknown as SlackEvent).isMention
      );
      results.push({ text: payload.text, isMention });
    }

    expect(results).toStrictEqual([
      { text: `<@${BOT_USER_ID}> 1`, isMention: true },
      {
        text: `mrkdwn probe: the app imports \`<@${BOT_USER_ID}>/passport\` and A &amp; B &lt;c&gt;`,
        isMention: false,
      },
      { text: `see \`<@${BOT_USER_ID}>\` for setup`, isMention: false },
      { text: "New request", isMention: true },
    ]);
  });
});
