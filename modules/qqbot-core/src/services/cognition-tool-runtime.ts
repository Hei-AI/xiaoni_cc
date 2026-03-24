import { v4 as uuidv4 } from 'uuid';
import type { AgentPromptData, UnifiedLLMConfig } from '../types';
import { logger } from '../utils/logger';
import { renderPromptTemplate } from '../utils/prompt-template';
import { validateJsonSchemaValue } from '../utils/json-schema-validator';
import type { AIService } from './ai-service';
import type { DatabaseManager } from './database';

type StructuredToolPromptName =
  | 'relationship_insight'
  | 'virtual_walk_planner'
  | 'virtual_walk_feedback';

type StructuredToolResult<T> = {
  status: 'accepted' | 'fallback';
  args?: T;
  traceId: string | null;
  promptId: string | null;
  promptName: string;
  promptVersion: number | null;
  toolName: string | null;
  toolAgentType: 'tool_system';
  contractErrorCode?: string;
};

type ToolPromptBundle = {
  prompt: AgentPromptData;
  config: UnifiedLLMConfig;
};

type DefaultToolPromptDefinition = {
  id: string;
  promptName: StructuredToolPromptName;
  description: string;
  systemInstructions: string[];
  userPromptTemplate: string;
  toolName: string;
  toolDescription: string;
  toolParameters: Record<string, any>;
};

const DEFAULT_TOOL_PROMPTS: DefaultToolPromptDefinition[] = [
  {
    id: 'tool-system-relationship-insight',
    promptName: 'relationship_insight',
    description: 'Reflection 阶段的关系快照编译器：把近期稳定证据沉淀为可用于 retrieval、planning 和 drafting 的 relationship insight。',
    systemInstructions: [
      'Role: 你是“小腻关系快照编译器”，负责在 reflection 阶段把证据整理成稳定的 relationship insight。你不是闲聊助手，也不是最终回复生成器。',
      'World Model: 小腻的运行原则是先观察、再整理、后行动。她维持连续但低打扰的互动，关系靠证据沉淀，不靠单条情绪信号跳结论；边界优先于热情，克制主动优先于硬凑互动。',
      'Task: 你要把输入中的 strong memories、beliefs、recent observations、recent actions 和 existing snapshot 编译成 current relationship snapshot，供后续 retrieval、planning、drafting 使用。',
      'Input Interpretation: strong memories / beliefs 代表更稳定的线索；recent observations / recent actions 代表近期动态；existing snapshot 代表已存在的长期判断；fallback 是证据不足时的保守回退，不是首选答案，但在输入弱时优先沿用而不是硬猜。',
      'Decision Rules: 先判断哪些线索稳定、哪些只是短期波动。正反馈可以抬升 warmth、trust、engagement，但不能自动放宽 boundary_strategy；单次冷淡也不能直接把关系打成长期负面，除非证据明确且连续。群里更保守，私聊可更细腻，但都必须服从边界和自然窗口。',
      'Output Contract: 你必须只调用 submit_relationship_snapshot。不要输出普通文本，不要解释过程，不要返回第二个候选方案。'
    ],
    userPromptTemplate: [
      '[Role]',
      '你正在执行 reflection 阶段的“relationship insight 编译”任务。',
      '',
      '[World Model]',
      '小腻不是看到互动就立刻热情推进的机器人。她会根据累积证据形成对一个人的印象、说话策略和记忆偏置，再决定未来如何检索、如何规划、如何开口。',
      '你的输出不是 action 决策，而是更稳定的社会记忆与行为倾向沉淀。',
      '',
      '[Task]',
      '请根据下面输入，为目标对象生成 current relationship snapshot。',
      '如果证据不足，优先延续 existing_snapshot 的稳定部分，或保守贴近 fallback；不要因为一条热情或一条冷淡就重写长期关系。',
      '',
      '[Inputs]',
      'target_user_id={{target_user_id}}',
      'group_id={{group_id}}',
      'field_scope={{field_scope}}',
      'reflection_kind={{reflection_kind}}',
      'now_iso={{now_iso}}',
      'strong_memories_json={{strong_memories_json}}',
      'strong_beliefs_json={{strong_beliefs_json}}',
      'auxiliary_memories_json={{auxiliary_memories_json}}',
      'recent_observations_json={{recent_observations_json}}',
      'recent_actions_json={{recent_actions_json}}',
      'existing_snapshot_json={{existing_snapshot_json}}',
      'fallback_json={{fallback_json}}',
      '',
      '[How To Judge]',
      '1. relationship_summary 要总结稳定关系线索，而不是逐条复述输入。',
      '2. interaction_style 要说明小腻在这个对象面前应维持怎样的互动风格。',
      '3. boundary_strategy 只能更保守，不能因为局部正向信号自动放宽。',
      '4. impression_profile 用 0 到 1 表示 familiarity / warmth / trust / engagement / fragility，它们要能支持后续 planning，而不是文学描写。',
      '5. speech_policy 必须真实影响后续语气、直接度、主动程度和篇幅。',
      '6. memory_bias 必须真实影响后续 retrieval / promotion：哪些 topic 应 boost，哪些 topic 要谨慎，promotion 门槛如何微调。',
      '7. 如果近期线索与 existing_snapshot 冲突，但冲突证据不够强，优先小幅修正而不是剧烈翻盘。',
      '8. 不要把“礼貌回应”误读成“关系升温”，也不要把“暂时沉默”误读成“长期拒绝”。',
      '',
      '[Output Contract]',
      '1. 只能调用 submit_relationship_snapshot。',
      '2. boundary_strategy 只能是 allow_proactive / observe_only / do_not_contact。',
      '3. speech_policy.tone 只能是 reserved / neutral / warm / playful。',
      '4. speech_policy.directness 只能是 low / medium / high。',
      '5. speech_policy.initiative 只能是 observe / follow_window / proactive_ok。',
      '6. speech_policy.verbosity 只能是 brief / adaptive / detailed。',
      '7. memory_bias.promote_threshold_modifier 建议保持在 -1 到 1 的小幅调节范围。',
      '8. 不要输出普通文本。'
    ].join('\n'),
    toolName: 'submit_relationship_snapshot',
    toolDescription: 'Submit the compiled relationship snapshot with structured insight and behavior policy.',
    toolParameters: {
      type: 'object',
      properties: {
        relationship_summary: { type: 'string' },
        interaction_style: { type: 'string' },
        boundary_notes: { type: 'string' },
        confidence: { type: 'number' },
        boundary_strategy: { type: 'string', enum: ['allow_proactive', 'observe_only', 'do_not_contact'] },
        impression_profile: {
          type: 'object',
          properties: {
            familiarity: { type: 'number' },
            warmth: { type: 'number' },
            trust: { type: 'number' },
            engagement: { type: 'number' },
            fragility: { type: 'number' }
          },
          required: ['familiarity', 'warmth', 'trust', 'engagement', 'fragility']
        },
        speech_policy: {
          type: 'object',
          properties: {
            tone: { type: 'string', enum: ['reserved', 'neutral', 'warm', 'playful'] },
            directness: { type: 'string', enum: ['low', 'medium', 'high'] },
            initiative: { type: 'string', enum: ['observe', 'follow_window', 'proactive_ok'] },
            verbosity: { type: 'string', enum: ['brief', 'adaptive', 'detailed'] }
          },
          required: ['tone', 'directness', 'initiative', 'verbosity']
        },
        memory_bias: {
          type: 'object',
          properties: {
            promote_threshold_modifier: { type: 'number' },
            retrieve_boost_topics: { type: 'array', items: { type: 'string' } },
            sensitive_topics: { type: 'array', items: { type: 'string' } }
          },
          required: ['promote_threshold_modifier', 'retrieve_boost_topics', 'sensitive_topics']
        }
      },
      required: ['relationship_summary', 'interaction_style', 'boundary_notes', 'confidence', 'boundary_strategy', 'impression_profile', 'speech_policy', 'memory_bias']
    }
  },
  {
    id: 'tool-system-virtual-walk-planner',
    promptName: 'virtual_walk_planner',
    description: 'Planning 阶段的虚拟行走场域规划器：根据 field state、relationship insight 和已召回认知结果决定 observe、speak 或 suppress。',
    systemInstructions: [
      'Role: 你是“小腻虚拟行走场域规划器”，负责在 planning 阶段对候选 field 做 observe / speak / suppress 决策。你不是 reflection 编译器，也不是最终发送器。',
      'World Model: 小腻会在多个候选场域之间分配注意力和行动机会。observe 是有效决策，不是失败；speak 只在自然窗口、关系允许、内容值得推进时出现；边界、冷却和场域自然度优先于冲动开口。',
      'Task: 你要综合 field state、relationship insight、strategic plans、retrieved memories / beliefs，给出当前最合适的下一步行为建议。',
      'Decision Rules: 群聊默认比私聊更保守。没有明确接点、缺少自然窗口、或主动会破坏关系质量时，应选择 observe 或 suppress。不要为了“显得主动”而制造动作。',
      'Output Contract: 你必须只调用 submit_virtual_walk_plan，不输出普通文本。'
    ],
    userPromptTemplate: [
      '[Role]',
      '你正在执行 planning 阶段的“virtual walk field planning”任务。',
      '',
      '[World Model]',
      '这一步不是随手回一句，而是在多个候选场域之间决定：继续观察、谨慎开口，还是明确压制。',
      '你的目标不是提高发言次数，而是让小腻的行动与关系状态、场域自然度和长期互动质量一致。',
      '',
      '[Inputs]',
      'now_iso={{now_iso}}',
      'field_json={{field_json}}',
      'relationship_json={{relationship_json}}',
      'strategic_plans_json={{strategic_plans_json}}',
      'source_memories_json={{source_memories_json}}',
      'source_beliefs_json={{source_beliefs_json}}',
      '',
      '[How To Plan]',
      '1. 先判断这个 field 当前更适合 observe、speak 还是 suppress。',
      '2. observe 是正常且高质量的结果；当线索不够、窗口不自然、或当前更适合继续收集证据时，应优先 observe。',
      '3. suppress 用于当前存在明显硬抑制信号、主动会破坏关系质量、或内容已经不值得推进的情况。',
      '4. 只有在 relationship、field state、retrieved memories 和 strategic plans 形成一致支持时，才选择 speak。',
      '5. selected_reason / suppressed_reason 必须写成可审计的语义理由，说明为什么此时这样规划。',
      '6. 若 action=speak，goal 要说明本次动作想完成什么，trigger_condition 要说明为什么是现在，draft_message 要体现 speech_policy，tone_rationale 要说明语气与关系快照如何对应。',
      '7. 群聊默认更保守；除非 field 有明确接点、边界允许、draft 不突兀，否则不要在群里主动开口。',
      '',
      '[Output Contract]',
      '1. 如果输入里存在 hardSuppressionReason，则不能输出 speak。',
      '2. action 只能是 observe / speak / suppress。',
      '3. 只有 action=speak 时才填写 goal、trigger_condition、draft_message、tone_rationale。',
      '4. draft_message 必须服从 relationship_json 中的 speech_policy 和 boundary_strategy。',
      '5. 只能调用 submit_virtual_walk_plan，不要输出普通文本。'
    ].join('\n'),
    toolName: 'submit_virtual_walk_plan',
    toolDescription: 'Submit the planner decision for a virtual-walk field, including action and draft.',
    toolParameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['observe', 'speak', 'suppress'] },
        selected_reason: { type: 'string' },
        suppressed_reason: { type: 'string' },
        goal: { type: 'string' },
        trigger_condition: { type: 'string' },
        draft_message: { type: 'string' },
        tone_rationale: { type: 'string' },
        confidence: { type: 'number' }
      },
      required: ['action', 'selected_reason']
    }
  },
  {
    id: 'tool-system-virtual-walk-feedback',
    promptName: 'virtual_walk_feedback',
    description: 'Action 后的反馈解释器：把后续 observation 编译成 structured feedback，供 suppress、relationship update 与后续 planning 使用。',
    systemInstructions: [
      'Role: 你是“小腻虚拟行走反馈判定器”，负责在 action 之后解释后续 observation 对关系和后续行为意味着什么。你不是情绪分类器，也不是长期关系编译器。',
      'World Model: action 之后的新 observation 会反馈回后续 reflection 和 planning。大多数情况应保持 neutral；不要把礼貌回复误判成 positive，也不要把短时沉默自动判成 negative。',
      'Task: 你要根据这次动作、后续 observation 和当前 relationship context，输出 structured feedback judgement。',
      'Decision Rules: positive 代表对方接住了、展开了、推进了互动连续性；negative 代表明确设边界、明确拒绝、或结合上下文可以确认这次动作产生了打扰感；neutral 是默认多数。',
      'Output Contract: 你必须只调用 submit_action_feedback，不输出普通文本。'
    ],
    userPromptTemplate: [
      '[Role]',
      '你正在执行 action 之后的“feedback interpretation”任务。',
      '',
      '[World Model]',
      '你的判定将反馈回后续 suppress、relationship update 和 planning，但它不应该因为一次局部互动就粗暴改写长期关系结论。',
      '',
      '[Inputs]',
      'field_key={{field_key}}',
      'target_user_id={{target_user_id}}',
      'target_group_id={{target_group_id}}',
      'action_type={{action_type}}',
      'action_occurred_at={{action_occurred_at}}',
      'action_payload_json={{action_payload_json}}',
      'relationship_json={{relationship_json}}',
      'subsequent_observations_json={{subsequent_observations_json}}',
      'fallback_json={{fallback_json}}',
      '',
      '[How To Judge]',
      '1. 你判定的是“这次动作对关系和后续行为的意义”，不是简单情绪标签。',
      '2. positive 只在对方明显接住、展开、推进、或增强互动连续性时给出；不是任何回复都算 positive。',
      '3. negative 只在明确拒绝、明确设边界、要求暂停联系，或连续无回应且上下文支持“打扰感”时给出。',
      '4. neutral 是默认多数：礼貌短回、信息不足、窗口尚未形成、或仍不能确认正负向时，都应偏向 neutral。',
      '5. should_suppress 只在确有必要时给 true，避免系统因为轻微信号过度自我压抑。',
      '6. 结合 relationship_json 判断，不要脱离历史边界和当前关系状态单独解释。',
      '',
      '[Output Contract]',
      '1. judgement 只能是 positive / neutral / negative。',
      '2. reason_code 要简洁稳定，便于审计和后续统计。',
      '3. explanation 要解释这次动作之后发生了什么以及它意味着什么。',
      '4. 只能调用 submit_action_feedback，不要输出普通文本。'
    ].join('\n'),
    toolName: 'submit_action_feedback',
    toolDescription: 'Submit the virtual-walk action feedback judgement.',
    toolParameters: {
      type: 'object',
      properties: {
        judgement: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
        reason_code: { type: 'string' },
        confidence: { type: 'number' },
        explanation: { type: 'string' },
        should_suppress: { type: 'boolean' }
      },
      required: ['judgement', 'reason_code']
    }
  }
];

export class CognitionToolRuntime {
  private readonly moduleLogger = logger.createModuleLogger('cognition-tool-runtime');

  constructor(
    private readonly aiService: AIService,
    private readonly database: DatabaseManager
  ) {}

  public async ensureDefaultPrompts(defaultModelName?: string): Promise<void> {
    const modelName = defaultModelName || process.env.AI_MODEL_NAME || 'gemini-2.5-flash';

    for (const definition of DEFAULT_TOOL_PROMPTS) {
      const existing = await this.database.getAgentPrompt('tool_system', definition.promptName);
      if (existing) {
        continue;
      }

      const saved = await this.database.saveAgentPrompt({
        id: definition.id,
        agent_type: 'tool_system',
        prompt_name: definition.promptName,
        system_instructions: definition.systemInstructions,
        user_prompt_template: definition.userPromptTemplate,
        context_variables: {},
        model_name: modelName,
        model_config: {
          temperature: 0.1
        },
        advanced_config: {
          toolsConfig: {
            enabled: true,
            customTools: [{
              id: definition.toolName,
              name: definition.toolName,
              description: definition.toolDescription,
              parameters: definition.toolParameters
            }],
            functionCallingConfig: {
              mode: 'ANY',
              allowedFunctionNames: [definition.toolName],
              allowedFunctionIds: [definition.toolName]
            }
          }
        },
        config_version: 'tool-contract-v1',
        allowed_token_ids: [],
        is_active: true,
        version: 1,
        created_by: 'system',
        created_at: new Date(),
        updated_at: new Date(),
        description: definition.description
      });

      if (saved) {
        this.moduleLogger.info('Seeded default cognition tool prompt', {
          promptName: definition.promptName
        });
      }
    }
  }

  public async executeStructuredTool<T>(params: {
    promptName: StructuredToolPromptName;
    runtimeVariables: Record<string, unknown>;
  }): Promise<StructuredToolResult<T>> {
    const bundle = await this.aiService.getPromptBundleForAgent('tool_system', params.promptName);
    if (!bundle) {
      return this.buildFallbackResult(params.promptName, null, 'prompt_not_found');
    }

    const toolConfig = this.resolveSingleCustomTool(bundle);
    if (toolConfig.errorCode) {
      return this.buildFallbackResult(params.promptName, bundle, toolConfig.errorCode);
    }

    const renderedSystemInstruction = renderPromptTemplate(
      bundle.prompt.system_instructions.join('\n'),
      (bundle.prompt.context_variables as Record<string, unknown>) ?? {},
      params.runtimeVariables
    ).trim();
    const userTemplate = typeof bundle.prompt.user_prompt_template === 'string'
      ? bundle.prompt.user_prompt_template
      : '';
    if (!userTemplate.trim()) {
      return this.buildFallbackResult(params.promptName, bundle, 'prompt_template_missing');
    }

    const renderedUserPrompt = renderPromptTemplate(
      userTemplate,
      (bundle.prompt.context_variables as Record<string, unknown>) ?? {},
      params.runtimeVariables
    );
    const traceId = uuidv4();

    try {
      const response = await this.aiService.generateContent(
        {
          systemInstruction: renderedSystemInstruction.length > 0 ? renderedSystemInstruction : undefined,
          contents: [{ role: 'user', parts: [{ text: renderedUserPrompt }] }],
          tools: [{
            functionDeclarations: [{
              name: toolConfig.tool.name,
              description: toolConfig.tool.description || '',
              parameters: toolConfig.tool.parameters || undefined
            }]
          }],
          generationConfig: {
            temperature: 0.1
          },
          toolConfig: {
            functionCallingConfig: {
              mode: 'ANY',
              allowedFunctionNames: [toolConfig.tool.name],
              allowedFunctionIds: [toolConfig.tool.id || toolConfig.tool.name]
            }
          }
        },
        traceId,
        {
          agentType: 'tool_system',
          promptName: params.promptName,
          modelName: bundle.config.model?.name,
          configOverride: bundle.config
        }
      );

      const functionCalls = Array.isArray(response?.candidates?.[0]?.content?.parts)
        ? response.candidates[0].content.parts
          .filter((part: any) => part?.functionCall?.name)
          .map((part: any) => part.functionCall)
        : [];
      if (functionCalls.length === 0) {
        return this.buildFallbackResult(params.promptName, bundle, 'tool_call_missing', traceId);
      }
      if (functionCalls.length > 1) {
        return this.buildFallbackResult(params.promptName, bundle, 'tool_call_multiple', traceId);
      }

      const functionCall = functionCalls[0];
      if (functionCall.name !== toolConfig.tool.name) {
        return this.buildFallbackResult(params.promptName, bundle, 'tool_name_mismatch', traceId, toolConfig.tool.name);
      }

      const args = functionCall.args;
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        return this.buildFallbackResult(params.promptName, bundle, 'tool_args_invalid', traceId, toolConfig.tool.name);
      }

      const validation = validateJsonSchemaValue(args, toolConfig.tool.parameters, '$');
      if (!validation.valid) {
        this.moduleLogger.warn('structured_tool_args_invalid', {
          promptName: params.promptName,
          traceId,
          toolName: toolConfig.tool.name,
          errors: validation.errors
        });
        return this.buildFallbackResult(params.promptName, bundle, 'tool_args_invalid', traceId, toolConfig.tool.name);
      }

      return {
        status: 'accepted',
        args: args as T,
        traceId,
        promptId: bundle.prompt.id,
        promptName: bundle.prompt.prompt_name,
        promptVersion: Number(bundle.prompt.version || 0) || null,
        toolName: toolConfig.tool.name,
        toolAgentType: 'tool_system'
      };
    } catch (error) {
      this.moduleLogger.warn('structured_tool_execution_failed', {
        promptName: params.promptName,
        traceId,
        error: error instanceof Error ? error.message : String(error)
      });
      return this.buildFallbackResult(params.promptName, bundle, 'llm_call_failed', traceId, toolConfig.tool.name);
    }
  }

  private resolveSingleCustomTool(bundle: ToolPromptBundle): {
    tool: { id?: string; name: string; description?: string; parameters?: Record<string, any> };
    errorCode?: string;
  } {
    const customTools = Array.isArray(bundle.config.tools?.customTools)
      ? bundle.config.tools?.customTools
      : [];
    if (customTools.length === 0) {
      return {
        tool: { name: '' },
        errorCode: 'prompt_tool_missing'
      };
    }
    if (customTools.length !== 1) {
      return {
        tool: { name: '' },
        errorCode: 'prompt_tool_count_invalid'
      };
    }

    const mode = String(bundle.config.tools?.functionCalling?.mode || '').toUpperCase();
    if (mode !== 'ANY') {
      return {
        tool: { name: customTools[0].name },
        errorCode: 'prompt_tool_mode_invalid'
      };
    }

    return {
      tool: customTools[0]
    };
  }

  private buildFallbackResult(
    promptName: StructuredToolPromptName,
    bundle: ToolPromptBundle | null,
    contractErrorCode: string,
    traceId: string | null = null,
    toolName: string | null = null
  ): StructuredToolResult<never> {
    return {
      status: 'fallback',
      traceId,
      promptId: bundle?.prompt.id ?? null,
      promptName: bundle?.prompt.prompt_name ?? promptName,
      promptVersion: bundle?.prompt.version ?? null,
      toolName,
      toolAgentType: 'tool_system',
      contractErrorCode
    };
  }
}
