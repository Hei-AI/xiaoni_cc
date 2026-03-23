import {
  geminiRequestToOpenResponseRequest,
  openResponseInputToGeminiRequest
} from '../llm-provider/helpers';

describe('llm-provider helpers', () => {
  it('keeps system instruction only in instructions when normalizing Gemini requests', () => {
    const request = geminiRequestToOpenResponseRequest({
      contents: [
        {
          role: 'user',
          parts: [{ text: 'hello world' }]
        }
      ],
      systemInstruction: {
        parts: [{ text: 'system prompt' }]
      },
      generationConfig: {
        temperature: 0.5
      }
    }, 'gpt-5.4-mini');

    expect(request.instructions).toBe('system prompt');
    expect(Array.isArray(request.input)).toBe(true);
    expect(request.input).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'hello world' }]
      }
    ]);
  });

  it('maps system input items back into Gemini systemInstruction without dropping user messages', () => {
    const normalized = openResponseInputToGeminiRequest({
      model: 'gpt-5.4-mini',
      instructions: 'system prompt',
      input: [
        {
          type: 'message',
          role: 'system',
          content: [{ type: 'input_text', text: 'extra system context' }]
        },
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hello world' }]
        }
      ]
    });

    expect(normalized.systemInstruction).toEqual({
      parts: [{ text: 'system prompt' }, { text: 'extra system context' }]
    });
    expect(normalized.contents).toEqual([
      {
        role: 'user',
        parts: [{ text: 'hello world' }]
      }
    ]);
  });
});
