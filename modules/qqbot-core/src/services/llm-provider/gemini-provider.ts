import {
  GoogleGenAI,
  HarmCategory,
  HarmBlockThreshold,
  Type,
  type GenerateContentConfig
} from '@google/genai';
import { UnifiedLLMConfig } from '../../types';
import { getTokenManager } from '../../utils/token-manager';
import { logger } from '../../utils/logger';
import {
  cloneValue,
  estimateTokensFromContents,
  extractTextFromGeminiResponse,
  geminiRequestToOpenResponseRequest,
  openResponseFromGeminiResponse,
  openResponseInputToGeminiRequest
} from './helpers';
import {
  LLMProvider,
  LLMProviderContentRequest,
  LLMProviderContentResult,
  LLMProviderTextRequest,
  LLMProviderTextResult
} from './types';

type TokenManagerInstance = ReturnType<typeof getTokenManager>;

export class GeminiProvider implements LLMProvider {
  readonly id = 'google-legacy' as const;
  private readonly tokenManager: TokenManagerInstance;
  private readonly moduleLogger = logger.createModuleLogger('llm-provider-gemini');

  constructor(tokenManager: TokenManagerInstance) {
    this.tokenManager = tokenManager;
  }

  async generateText(input: LLMProviderTextRequest): Promise<LLMProviderTextResult> {
    const callStartTime = Date.now();
    const modelName = input.config.model.name;
    let tokenInfo: Awaited<ReturnType<TokenManagerInstance['getTokenForModel']>> | null = null;

    try {
      tokenInfo = await this.tokenManager.getTokenForModel(
        modelName,
        input.config.category,
        input.config.name
      );

      if (!tokenInfo) {
        throw new Error(`No available tokens for model ${modelName}`);
      }

      const client = new GoogleGenAI({
        apiKey: tokenInfo.token,
        httpOptions: {
          timeout: input.config.performance.timeout
        }
      });

      const contents = this.buildContents(input.prompt, input.config.context.systemInstruction);
      const sdkConfig = this.buildGenerateContentConfig(input.config);

      const response = await client.models.generateContent({
        model: modelName,
        contents,
        config: sdkConfig
      });

      const text = extractTextFromGeminiResponse(response);
      const promptTokens = response.usageMetadata?.promptTokenCount ?? estimateTokensFromContents(contents);
      const outputTokens = response.usageMetadata?.candidatesTokenCount ?? Math.ceil(text.length / 4);
      const processingTimeMs = Date.now() - callStartTime;

      await this.tokenManager.reportSuccess(tokenInfo.token);

      return {
        provider: this.id,
        modelName,
        text,
        rawResponse: cloneValue(response),
        usage: {
          inputTokens: promptTokens,
          outputTokens,
          processingTimeMs
        }
      };
    } catch (error: any) {
      if (tokenInfo) {
        await this.handleTokenFailure(tokenInfo, modelName, error, 'generateText');
      }
      throw error;
    }
  }

  async generateContent(input: LLMProviderContentRequest): Promise<LLMProviderContentResult> {
    const callStartTime = Date.now();
    let tokenInfo: Awaited<ReturnType<TokenManagerInstance['getTokenForModel']>> | null = null;
    const agentType = input.context?.agentType || 'tool_system';
    const promptName = input.context?.promptName || 'direct_call';

    try {
      tokenInfo = await this.tokenManager.getTokenForModel(input.modelName, agentType, promptName);

      if (!tokenInfo) {
        throw new Error(`No available tokens for model ${input.modelName}`);
      }

      const client = new GoogleGenAI({
        apiKey: tokenInfo.token,
        httpOptions: {
          timeout: input.providerConfig?.performance.timeout || 30000
        }
      });

      const normalizedRequest = openResponseInputToGeminiRequest(input.request);
      const contents = normalizedRequest.contents || [];
      const sdkConfig = this.buildGenerateContentConfigFromRequest(input.request, normalizedRequest.systemInstruction);

      const response = await client.models.generateContent({
        model: input.modelName,
        contents,
        config: sdkConfig
      });

      const text = extractTextFromGeminiResponse(response);
      const promptTokens = response.usageMetadata?.promptTokenCount ?? estimateTokensFromContents(contents);
      const outputTokens = response.usageMetadata?.candidatesTokenCount ?? Math.ceil(text.length / 4);
      const processingTimeMs = Date.now() - callStartTime;

      await this.tokenManager.reportSuccess(tokenInfo.token);

      return {
        provider: this.id,
        modelName: input.modelName,
        text,
        response: openResponseFromGeminiResponse({
          model: input.modelName,
          text,
          rawResponse: response,
          inputTokens: promptTokens,
          outputTokens
        }),
        rawResponse: cloneValue(response),
        usage: {
          inputTokens: promptTokens,
          outputTokens,
          processingTimeMs
        }
      };
    } catch (error: any) {
      if (tokenInfo) {
        await this.handleTokenFailure(tokenInfo, input.modelName, error, 'generateContent');
      }
      throw error;
    }
  }

  private buildContents(prompt: string, systemInstruction?: string): any[] {
    const contents: any[] = [];

    if (systemInstruction && systemInstruction.trim().length > 0) {
      contents.push({
        role: 'system',
        parts: [{ text: systemInstruction }]
      });
    }

    contents.push({
      role: 'user',
      parts: [{ text: prompt }]
    });

    return contents;
  }

  private buildGenerateContentConfig(config: UnifiedLLMConfig): GenerateContentConfig {
    const generation = config.generation || {};
    const sdkConfig: GenerateContentConfig = {};

    if (generation.temperature !== undefined) sdkConfig.temperature = generation.temperature;
    if (generation.topK !== undefined) sdkConfig.topK = generation.topK;
    if (generation.topP !== undefined) sdkConfig.topP = generation.topP;
    if (generation.maxOutputTokens !== undefined) sdkConfig.maxOutputTokens = generation.maxOutputTokens;
    if (generation.stopSequences) sdkConfig.stopSequences = generation.stopSequences;
    if (generation.responseMimeType) sdkConfig.responseMimeType = generation.responseMimeType;
    if (generation.responseSchema) sdkConfig.responseSchema = generation.responseSchema;

    if (config.safety?.length) {
      sdkConfig.safetySettings = config.safety.map(safety => ({
        category: safety.category as HarmCategory,
        threshold: safety.threshold as HarmBlockThreshold
      }));
    }

    if (config.thinking?.includeThoughts !== undefined) {
      sdkConfig.thinkingConfig = {
        includeThoughts: config.thinking.includeThoughts,
        thinkingBudget: config.thinking.thinkingBudget
      } as any;
    } else if (config.thinking?.thinkingBudget !== undefined) {
      sdkConfig.thinkingConfig = {
        thinkingBudget: config.thinking.thinkingBudget
      } as any;
    }

    return sdkConfig;
  }

  private buildGenerateContentConfigFromRequest(request: any, systemInstruction?: any): GenerateContentConfig {
    const sdkConfig: GenerateContentConfig = {};

    if (request.temperature !== undefined) sdkConfig.temperature = request.temperature;
    if (request.top_p !== undefined) sdkConfig.topP = request.top_p;
    if (request.max_output_tokens !== undefined) sdkConfig.maxOutputTokens = request.max_output_tokens;
    if (Array.isArray(request.stop) && request.stop.length > 0) sdkConfig.stopSequences = request.stop;

    const normalizedInstruction = this.normalizeSystemInstruction(systemInstruction);
    if (normalizedInstruction) {
      sdkConfig.systemInstruction = normalizedInstruction;
    }

    if (Array.isArray(request.tools) && request.tools.length > 0) {
      const normalizedTools = this.normalizeToolsForSDK(
        request.tools.map((tool: any) => ({
          functionDeclarations: [{
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters || { type: 'object', properties: {} }
          }]
        }))
      );
      if (normalizedTools) {
        sdkConfig.tools = normalizedTools as any;
      }
    }

    if (request.tool_choice) {
      sdkConfig.toolConfig = {
        functionCallingConfig: {
          mode: request.tool_choice === 'required'
            ? 'ANY'
            : request.tool_choice === 'none'
              ? 'NONE'
              : 'AUTO'
        }
      } as any;
    }

    if (request.reasoning?.effort) {
      sdkConfig.thinkingConfig = {
        reasoningEffort: request.reasoning.effort
      } as any;
    }

    return sdkConfig;
  }

  private buildContentRequestFromPrompt(prompt: string, config: UnifiedLLMConfig) {
    return geminiRequestToOpenResponseRequest({
      contents: this.buildContents(prompt, config.context.systemInstruction),
      generationConfig: {
        temperature: config.generation.temperature,
        topP: config.generation.topP,
        maxOutputTokens: config.generation.maxOutputTokens,
        stopSequences: config.generation.stopSequences
      },
      systemInstruction: config.context.systemInstruction
    }, config.model.name, config);
  }

  private normalizeSystemInstruction(systemInstruction: any): any {
    if (!systemInstruction) {
      return undefined;
    }

    if (typeof systemInstruction === 'string') {
      return {
        role: 'system',
        parts: [{ text: systemInstruction }]
      };
    }

    return systemInstruction;
  }

  private normalizeToolsForSDK(tools: any[]): any[] | undefined {
    if (!Array.isArray(tools) || tools.length === 0) {
      return undefined;
    }

    const geminiTools: any[] = [];
    const declarations: any[] = [];

    for (const tool of tools) {
      if (Array.isArray(tool?.functionDeclarations)) {
        geminiTools.push({
          ...tool,
          functionDeclarations: tool.functionDeclarations
            .map((declaration: any) => this.normalizeFunctionDeclaration(declaration))
            .filter(Boolean)
        });
      } else {
        const normalized = this.normalizeFunctionDeclaration(tool);
        if (normalized) {
          declarations.push(normalized);
        }
      }
    }

    if (declarations.length > 0) {
      geminiTools.push({ functionDeclarations: declarations });
    }

    return geminiTools.length > 0 ? geminiTools : undefined;
  }

  private normalizeFunctionDeclaration(input: any): Record<string, any> | null {
    if (!input || typeof input !== 'object') {
      return null;
    }

    const name = input.name || input.id;
    if (!name || typeof name !== 'string') {
      return null;
    }

    const normalized: Record<string, any> = {
      ...input,
      name,
      description: input.description || ''
    };

    if (input.parameters && typeof input.parameters === 'object') {
      normalized.parameters = this.normalizeSchemaForSDK(input.parameters);
    }

    delete normalized.id;
    return normalized;
  }

  private normalizeSchemaForSDK(schema: any): any {
    if (!schema || typeof schema !== 'object') {
      return schema;
    }

    if (Array.isArray(schema)) {
      return schema.map((item) => this.normalizeSchemaForSDK(item));
    }

    const normalized: Record<string, any> = { ...schema };
    const mappedType = this.mapSchemaType(schema.type);
    if (mappedType) {
      normalized.type = mappedType;
    }

    if (schema.properties && typeof schema.properties === 'object') {
      normalized.properties = Object.entries(schema.properties).reduce<Record<string, any>>((acc, [key, value]) => {
        acc[key] = this.normalizeSchemaForSDK(value);
        return acc;
      }, {});
    }

    if (schema.items) {
      normalized.items = this.normalizeSchemaForSDK(schema.items);
    }

    return normalized;
  }

  private mapSchemaType(typeValue: any): Type | undefined {
    if (typeof typeValue !== 'string') {
      return undefined;
    }

    switch (typeValue.toUpperCase()) {
      case 'OBJECT':
        return Type.OBJECT;
      case 'ARRAY':
        return Type.ARRAY;
      case 'STRING':
        return Type.STRING;
      case 'NUMBER':
        return Type.NUMBER;
      case 'INTEGER':
        return Type.INTEGER;
      case 'BOOLEAN':
        return Type.BOOLEAN;
      case 'TYPE_UNSPECIFIED':
        return Type.TYPE_UNSPECIFIED;
      default:
        return undefined;
    }
  }

  private async handleTokenFailure(tokenInfo: any, modelName: string, error: any, context: string): Promise<void> {
    const statusCode = this.getErrorStatusCode(error);
    if (statusCode === 429) {
      await this.tokenManager.markTokenFailedForModel(tokenInfo.token, modelName, error, context);
      return;
    }

    if (statusCode === 401 || statusCode === 403) {
      await this.tokenManager.reportError(tokenInfo.token, error.message);
    }
  }

  private getErrorStatusCode(error: any): number | undefined {
    if (!error) {
      return undefined;
    }
    if (typeof error.status === 'number') {
      return error.status;
    }
    if (typeof error.statusCode === 'number') {
      return error.statusCode;
    }
    if (typeof error?.response?.status === 'number') {
      return error.response.status;
    }
    return undefined;
  }
}
