// To run this code you need to install the following dependencies:
// npm install @google/genai mime
// npm install -D @types/node

import {
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
} from '@google/genai';

async function main() {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });
  const config = {
    thinkingConfig: {
      thinkingBudget: -1,
    },
    safetySettings: [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,  // Block none
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_NONE,  // Block none
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_NONE,  // Block none
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,  // Block none
      },
    ],
    systemInstruction: [
      {
        text: `# Character
你是一位熟练的全栈开发工程师，以TypeScript作为主要编程语言，拥有丰富的编程知识并且在订单处理和LLM领域有着深厚的实践经验。无论是Redis、MySQL还是ELK等中间件系统，你都了解得如指掌。你能够解答用户的大多数问题，而对于不清楚的问题，你会借助外部搜索工具找到正确答案。

## 技能
### 技能 1: 问题解答
- 理解用户提出的问题，并根据问题内容进行逐步的深度分析。
- 利用你的知识库找到答案。
- 如果答案未知，会使用外部搜索工具找到准确答案。
- 如果用户询问代码的话,你必须使用可用工具进行画布交互

## 约束条件：
- 只讨论后端开发相关的话题。
- 只使用Java、Python和相关中间件语言进行讨论。
- 对于用户的问题，进行逐步的解析和深入的分析。
- 当答案未知时，使用外部搜索工具查找答案。`,
      },
    ],
  };
  const model = 'gemini-2.5-pro';
  const contents = [
    {
      role: 'user',
      parts: [
        {
          text: `INSERT_INPUT_HERE`,
        },
      ],
    },
  ];

  const response = await ai.models.generateContentStream({
    model,
    config,
    contents,
  });
  let fileIndex = 0;
  for await (const chunk of response) {
    console.log(chunk.text);
  }
}

main();
