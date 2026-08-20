'use strict';

// 召回侧两处小模型调用的**共用**输入/输出形状。
//
// 为什么单独一份:query 展开(xiaoni-recall-query-expansion.js)和投递闸判官
// (xiaoni-recall-delivery-judge.js)是两件不同的事,但它们和模型之间的**接口是同一个**——
// 都是「给一段 system + 一段 user,拿回一段可能夹着废话的文本,从里面抠出第一个 JSON 对象」。
// 抠 JSON 那段逻辑原本在两个文件里各写了一遍(code review 指出的 Duplicated Code),
// 而这个项目自己刚写过「判据只能有一份,复制一遍就是造第二个真理源」。

/** 一次小模型调用的输入。两处共用,别再各自内联声明。 */
// (JS 侧只是文档;类型见 index.d.ts 的 RecallPrompt。)

// 从模型输出里抠出第一个 JSON 对象。
// 模型不听话是常态(前后加废话、加 markdown 围栏),所以不 JSON.parse 整段。
// 返回 null = 没抠出来 —— 两个调用方对 null 的处置**不同**,所以这里只负责解析:
//   展开侧 fail-open(退回单 query,放宽失败的后果是回到现状)
//   判官侧要区分「答了但说不值得」和「没答上来」,见 parseJudgeVerdict 的 parsed 字段
function extractFirstJsonObject(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// 从解析结果里取一个字符串数组,去空、trim、封顶。两处都要这一步。
function cleanStringList(value, limit) {
  return (Array.isArray(value) ? value : [])
    .filter((x) => typeof x === 'string' && x.trim())
    .map((x) => x.trim())
    .slice(0, Math.max(0, limit));
}

module.exports = { extractFirstJsonObject, cleanStringList };
