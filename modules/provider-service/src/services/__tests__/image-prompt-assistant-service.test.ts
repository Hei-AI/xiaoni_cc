import test from 'node:test';
import assert from 'node:assert/strict';
import { ImagePromptAssistantService } from '../image-provider/prompt-assistant';
import { LLMProvider, LLMProviderContentRequest } from '../llm-provider/types';

class FakePromptProvider implements LLMProvider {
  readonly id = 'codex' as const;
  lastRequest?: LLMProviderContentRequest;
  args: Record<string, any>;

  constructor(args: Record<string, any>) {
    this.args = args;
  }

  async generateText(): Promise<any> {
    throw new Error('not used');
  }

  async generateContent(input: LLMProviderContentRequest): Promise<any> {
    this.lastRequest = input;
    return {
      provider: 'codex',
      modelName: input.modelName,
      text: '',
      response: {
        status: 'completed',
        model: input.modelName,
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          total_tokens: 2
        },
        output: [
          {
            type: 'function_call',
            name: 'compose_image_prompt',
            arguments: JSON.stringify(this.args)
          }
        ]
      },
      rawResponse: {},
      canonicalRequest: input.request,
      wireRequest: input.request,
      canonicalResponse: {},
      wireResponse: {},
      requestFormatVersion: 'test',
      wireProviderFormat: 'test',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        processingTimeMs: 1
      }
    };
  }
}

function validArgs(overrides: Record<string, any> = {}) {
  return {
    finalPrompt: 'Epic low-angle dark Eastern fantasy scene, clear subject hierarchy, cinematic shadows.',
    detectedUseCase: 'scene',
    summary: 'Expanded the rough idea into a cinematic fantasy prompt.',
    sections: {
      subject: 'Monkey King walking toward three demon kings',
      scene: 'Mythic mountain throne room',
      style: 'Dark Eastern fantasy',
      composition: 'Low angle with scale contrast',
      camera: 'Long lens, grounded perspective',
      lighting: 'Hard shadows and cold rim light',
      details: 'Armor, throne materials, mist, carved patterns',
      constraints: 'No watermark, no text'
    },
    suggested: {
      size: '1024x1024',
      quality: 'high',
      format: 'png'
    },
    warnings: [],
    ...overrides
  };
}

test('image prompt assistant requires structured tool output and returns normalized result', async () => {
  const fake = new FakePromptProvider(validArgs());
  const service = new ImagePromptAssistantService({
    modelName: 'gpt-5-mini',
    providerFactory: () => fake
  });

  const result = await service.compose({
    prompt: '西游记狮驼岭，三个妖王王座，悟空背影，黑暗中式怪异风',
    mode: 'generate',
    size: '1024x1024',
    quality: 'high',
    format: 'png'
  });

  assert.equal(result.detectedUseCase, 'scene');
  assert.match(result.finalPrompt, /Eastern fantasy/);
  assert.equal(result.sourcePatterns.some((pattern) => pattern.id === 'dark-eastern-fantasy-scene'), true);
  assert.equal(fake.lastRequest?.request.tool_choice, 'required');
  assert.equal(fake.lastRequest?.request.tools?.[0]?.type, 'function');
});

test('image prompt assistant rejects empty prompt before calling provider', async () => {
  const fake = new FakePromptProvider(validArgs());
  const service = new ImagePromptAssistantService({
    providerFactory: () => fake
  });

  await assert.rejects(
    () => service.compose({ prompt: '   ' }),
    /Prompt is required/
  );
  assert.equal(fake.lastRequest, undefined);
});

test('image prompt assistant fails when tool output is missing required fields', async () => {
  const fake = new FakePromptProvider(validArgs({ finalPrompt: '' }));
  const service = new ImagePromptAssistantService({
    providerFactory: () => fake
  });

  await assert.rejects(
    () => service.compose({ prompt: '做一张产品海报' }),
    /missing finalPrompt/
  );
});
