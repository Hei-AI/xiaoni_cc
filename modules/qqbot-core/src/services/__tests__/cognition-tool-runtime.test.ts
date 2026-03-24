import { jest } from '@jest/globals';
import { CognitionToolRuntime } from '../cognition-tool-runtime';

describe('CognitionToolRuntime', () => {
  it('seeds high-quality default tool_system prompts when missing', async () => {
    const getAgentPrompt = jest.fn<(...args: any[]) => Promise<any>>();
    const saveAgentPrompt = jest.fn<(...args: any[]) => Promise<any>>();
    getAgentPrompt.mockResolvedValue(null);
    saveAgentPrompt.mockResolvedValue(true);
    const database = {
      getAgentPrompt,
      saveAgentPrompt
    } as any;
    const aiService = {} as any;

    const runtime = new CognitionToolRuntime(aiService, database);
    await runtime.ensureDefaultPrompts('gemini-2.5-flash');

    expect(database.getAgentPrompt).toHaveBeenCalledTimes(3);
    expect(database.saveAgentPrompt).toHaveBeenCalledTimes(3);

    const savedPrompts = database.saveAgentPrompt.mock.calls.map((call: any[]) => call[0]);
    expect(savedPrompts.map((prompt: any) => prompt.prompt_name)).toEqual([
      'relationship_insight',
      'virtual_walk_planner',
      'virtual_walk_feedback'
    ]);

    savedPrompts.forEach((prompt: any) => {
      expect(prompt.agent_type).toBe('tool_system');
      expect(prompt.description).toBeTruthy();
      expect(prompt.system_instructions.join('\n')).toContain('World Model');
      expect(prompt.user_prompt_template).toContain('[Role]');
      expect(prompt.user_prompt_template).toContain('[Output Contract]');
      expect(prompt.advanced_config.toolsConfig.customTools).toHaveLength(1);
      expect(prompt.advanced_config.toolsConfig.functionCallingConfig.mode).toBe('ANY');
    });
  });

  it('does not overwrite existing prompts', async () => {
    const getAgentPrompt = jest.fn<(...args: any[]) => Promise<any>>();
    const saveAgentPrompt = jest.fn<(...args: any[]) => Promise<any>>();
    getAgentPrompt.mockResolvedValue({ id: 'existing-prompt' });
    const database = {
      getAgentPrompt,
      saveAgentPrompt
    } as any;
    const runtime = new CognitionToolRuntime({} as any, database);

    await runtime.ensureDefaultPrompts('gemini-2.5-flash');

    expect(database.getAgentPrompt).toHaveBeenCalledTimes(3);
    expect(database.saveAgentPrompt).not.toHaveBeenCalled();
  });

  it('executes a structured tool call from a DB prompt bundle', async () => {
    const getPromptBundleForAgent = jest.fn<(...args: any[]) => Promise<any>>();
    const generateContent = jest.fn<(...args: any[]) => Promise<any>>();
    getPromptBundleForAgent.mockResolvedValue({
      prompt: {
        id: 'prompt-1',
        prompt_name: 'relationship_insight',
        version: 3,
        system_instructions: ['Role {{name}}'],
        user_prompt_template: 'payload={{payload}}',
        context_variables: { name: '小腻' }
      },
      config: {
        model: { name: 'gemini-2.5-flash' },
        tools: {
          functionCalling: { mode: 'ANY' },
          customTools: [
            {
              id: 'submit_relationship_snapshot',
              name: 'submit_relationship_snapshot',
              description: 'submit snapshot',
              parameters: {
                type: 'object',
                properties: {
                  relationship_summary: { type: 'string' }
                },
                required: ['relationship_summary']
              }
            }
          ]
        }
      }
    });
    generateContent.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: 'submit_relationship_snapshot',
                  args: {
                    relationship_summary: '当前关系保持克制而连续'
                  }
                }
              }
            ]
          }
        }
      ]
    });
    const aiService = {
      getPromptBundleForAgent,
      generateContent
    } as any;

    const runtime = new CognitionToolRuntime(aiService, {} as any);
    const result = await runtime.executeStructuredTool<{ relationship_summary: string }>({
      promptName: 'relationship_insight',
      runtimeVariables: {
        payload: { source: 'test' }
      }
    });

    expect(aiService.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        systemInstruction: 'Role 小腻',
        contents: [{ role: 'user', parts: [{ text: 'payload={"source":"test"}' }] }]
      }),
      expect.any(String),
      expect.objectContaining({
        agentType: 'tool_system',
        promptName: 'relationship_insight'
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'accepted',
        promptId: 'prompt-1',
        promptName: 'relationship_insight',
        promptVersion: 3,
        toolName: 'submit_relationship_snapshot',
        args: {
          relationship_summary: '当前关系保持克制而连续'
        }
      })
    );
  });

  it('falls back when the LLM response does not call the configured tool', async () => {
    const getPromptBundleForAgent = jest.fn<(...args: any[]) => Promise<any>>();
    const generateContent = jest.fn<(...args: any[]) => Promise<any>>();
    getPromptBundleForAgent.mockResolvedValue({
      prompt: {
        id: 'prompt-2',
        prompt_name: 'virtual_walk_feedback',
        version: 1,
        system_instructions: ['feedback judge'],
        user_prompt_template: 'feedback={{payload}}',
        context_variables: {}
      },
      config: {
        model: { name: 'gemini-2.5-flash' },
        tools: {
          functionCalling: { mode: 'ANY' },
          customTools: [
            {
              id: 'submit_action_feedback',
              name: 'submit_action_feedback',
              parameters: {
                type: 'object',
                properties: {
                  judgement: { type: 'string' }
                },
                required: ['judgement']
              }
            }
          ]
        }
      }
    });
    generateContent.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [{ text: 'plain text only' }]
          }
        }
      ]
    });
    const aiService = {
      getPromptBundleForAgent,
      generateContent
    } as any;

    const runtime = new CognitionToolRuntime(aiService, {} as any);
    const result = await runtime.executeStructuredTool({
      promptName: 'virtual_walk_feedback',
      runtimeVariables: {
        payload: 'test'
      }
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'fallback',
        promptId: 'prompt-2',
        promptName: 'virtual_walk_feedback',
        contractErrorCode: 'tool_call_missing'
      })
    );
  });
});
