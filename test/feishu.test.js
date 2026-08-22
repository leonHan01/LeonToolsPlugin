import assert from "node:assert/strict";
import { test } from "node:test";
import { cardPayload, clipText, signRequest } from "../js/feishu.js";

test("clipText truncates long bodies", () => {
  assert.equal(clipText("  hi  "), "hi");
  assert.equal(clipText("abcdefghij", 4), "abcd…");
});

test("cardPayload uses interactive header template", () => {
  const payload = cardPayload("新增待办", "写测试", "orange");
  assert.equal(payload.msg_type, "interactive");
  assert.equal(payload.card.schema, "2.0");
  assert.equal(payload.card.header.title.content, "新增待办");
  assert.equal(payload.card.header.template, "orange");
  assert.equal(payload.card.body.elements[0].tag, "markdown");
  assert.equal(payload.card.body.elements[0].content, "写测试");
});

test("signRequest is stable hmac for known input", async () => {
  const sign = await signRequest("demo", "1599360473");
  assert.equal(typeof sign, "string");
  assert.ok(sign.length > 10);
  assert.equal(await signRequest("demo", "1599360473"), sign);
});
