import { el, icon } from "./dom.js";
import { appendMessage, completePrompt, createSession } from "./llm.js";

const ANALYSIS_SYSTEM = `你是工作效率顾问。根据用户的便签和待办，分析其工作并给出能立刻执行的效率建议。
规则：
1. 使用中文。
2. 回复的第一行必须严格是「TL;DR：」后接一句不超过 40 字的总结，这一行前面不能有任何其他文字。
3. 空一行后按下面结构写：当前工作概况、优先级（先做什么）、最多 3 条可执行改进。
4. 不要客套，不要复述全部原文。`;

function linesOf(items, emptyLabel) {
  if (!items.length) return emptyLabel;
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

export function snapshotPrompt(notes, todos) {
  const openTodos = todos.filter((item) => !item.done);
  const doneTodos = todos.filter((item) => item.done);
  return [
    "请分析我的工作并帮助提升效率。回复必须以「TL;DR：」开头。",
    "",
    "【便签】",
    linesOf(notes.map((item) => item.content), "（暂无便签）"),
    "",
    "【未完成待办】",
    linesOf(openTodos.map((item) => item.content), "（没有未完成待办）"),
    "",
    "【已完成待办】",
    linesOf(doneTodos.map((item) => item.content), "（没有已完成待办）"),
  ].join("\n");
}

export function ensureTldr(content) {
  const text = String(content || "").trim();
  if (/^TL;\s*DR[:：]/i.test(text)) {
    return text.replace(/^TL;\s*DR[:：]\s*/i, "TL;DR：");
  }
  const first = text.split("\n").find((line) => line.trim()) || "见下文分析。";
  return `TL;DR：${first.replace(/^[#*\-\s]+/, "").slice(0, 40)}\n\n${text}`;
}

export async function analyzeWork() {
  const [{ loadNotes }, { loadTodos }] = await Promise.all([import("./notes.js"), import("./todos.js")]);
  const [{ notes }, { todos }] = await Promise.all([loadNotes(), loadTodos()]);
  if (!notes.length && !todos.length) {
    throw new Error("还没有便签或待办可分析");
  }
  const reply = await completePrompt({
    system: ANALYSIS_SYSTEM,
    user: snapshotPrompt(notes, todos),
  });
  const content = ensureTldr(reply.content);
  const openCount = todos.filter((item) => !item.done).length;
  await createSession("工作分析");
  await appendMessage({
    role: "user",
    content: `请分析我的工作（便签 ${notes.length} 条，待办 ${todos.length} 条，未完成 ${openCount} 条），帮助提升效率。`,
  });
  await appendMessage({
    role: "assistant",
    content,
    reasoning: reply.reasoning,
  });
  return { content, reasoning: reply.reasoning };
}

export function renderAnalysisBar({ toast, openSheet, closeSheet }) {
  const btn = el("button", { class: "btn ghost", type: "button", title: "用 LLM 分析便签和待办" }, icon("sparkles"), "AI分析");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      toast("正在分析工作…");
      const result = await analyzeWork();
      openSheet(
        "工作分析",
        el("div", { class: "analysis-result note-text" }, result.content),
        [el("button", { class: "btn primary", type: "button", onClick: closeSheet }, "关闭")]
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : "分析失败");
    } finally {
      btn.disabled = false;
    }
  });
  return el("div", { class: "page-toolbar" }, btn);
}
