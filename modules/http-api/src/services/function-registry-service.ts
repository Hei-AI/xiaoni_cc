import Ajv, { JSONSchemaType } from 'ajv';
import addFormats from 'ajv-formats';
import {
  FunctionDefinition,
  FunctionCallingMode,
  FunctionDefinitionRecord,
  FunctionInvokeMethod,
  FunctionAuthType,
  PromptFunctionAggregate,
  FunctionInvokeRequest,
  FunctionInvokeResult
} from '../types/function';
import {
  FunctionRepository,
  FunctionRepositoryType,
  CreateFunctionPayload,
  FunctionListParams,
  FunctionListResult,
  UpdateFunctionPayload
} from '../repositories/function-repository';
import {
  PromptBindingRepository,
  PromptBindingRepositoryType,
  PromptBindingPayload
} from '../repositories/prompt-binding-repository';
import {
  FunctionExecutionLogRepository,
  FunctionExecutionLogRepositoryType
} from '../repositories/function-execution-log-repository';
import { createModuleLogger } from '../utils/logger';
import { Pool } from 'mysql2/promise';
import axios, { AxiosRequestConfig } from 'axios';

const logger = createModuleLogger('function-registry-service');

const ajv = new Ajv({
  allErrors: true,
  strict: false
});
addFormats(ajv);

const defaultSchema = {
  type: 'object',
  properties: {},
  additionalProperties: true
};

const functionDefinitionSchema: JSONSchemaType<Omit<CreateFunctionPayload, 'parametersSchema'>> = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    displayName: { type: 'string' },
    description: { type: 'string', nullable: true },
    sideEffect: { type: 'boolean', nullable: true },
    expectResponse: { type: 'boolean', nullable: true },
    category: { type: 'string', nullable: true },
    tags: { type: 'array', nullable: true, items: { type: 'string' } },
    invokeMethod: { type: 'string', enum: ['HTTP', 'GRPC', 'INTERNAL'] },
    invokeUrl: { type: 'string', nullable: true },
    httpMethod: { type: 'string', nullable: true },
    authType: { type: 'string', nullable: true, enum: ['NONE', 'SERVICE_TOKEN', 'BASIC', 'CUSTOM'] },
    timeoutMs: { type: 'number', nullable: true },
    retryPolicy: { type: 'object', nullable: true, additionalProperties: true },
    executionAdapter: { type: 'string', nullable: true },
    managedBySystem: { type: 'boolean', nullable: true },
    enabled: { type: 'boolean', nullable: true },
    createdBy: { type: 'string', nullable: true }
  },
  required: ['name', 'displayName', 'invokeMethod'],
  additionalProperties: true
};

const validateFunctionMetadata = ajv.compile(functionDefinitionSchema);

export class FunctionRegistryService {
  private functionRepository: FunctionRepositoryType;
  private promptBindingRepository: PromptBindingRepositoryType;
  private executionLogRepository: FunctionExecutionLogRepositoryType;

  constructor(pool: Pool) {
    this.functionRepository = FunctionRepository(pool);
    this.promptBindingRepository = PromptBindingRepository(pool, this.functionRepository);
    this.executionLogRepository = FunctionExecutionLogRepository(pool);
  }

  async listFunctions(params: FunctionListParams): Promise<FunctionListResult> {
    return this.functionRepository.listFunctions(params);
  }

  async getFunction(id: string): Promise<FunctionDefinition | null> {
    return this.functionRepository.findById(id);
  }

  async createFunction(payload: CreateFunctionPayload & { parametersSchema?: any }): Promise<FunctionDefinition> {
    if (!payload.parametersSchema) {
      payload.parametersSchema = defaultSchema;
    }

    const metadata = { ...payload };
    if (!validateFunctionMetadata(metadata)) {
      const message = `Function metadata validation failed: ${ajv.errorsText(validateFunctionMetadata.errors)}`;
      logger.warn(message, { errors: validateFunctionMetadata.errors });
      throw new Error(message);
    }

    return this.functionRepository.createFunction(payload);
  }

  async updateFunction(id: string, payload: UpdateFunctionPayload): Promise<FunctionDefinition | null> {
    return this.functionRepository.updateFunction(id, payload);
  }

  async setFunctionEnabled(id: string, enabled: boolean, actor?: string): Promise<boolean> {
    return this.functionRepository.setFunctionEnabled(id, enabled, actor);
  }

  async getPromptFunctions(promptId: string): Promise<PromptFunctionAggregate> {
    return this.promptBindingRepository.getPromptFunctions(promptId);
  }

  async replacePromptBindings(promptId: string, payload: PromptBindingPayload): Promise<PromptFunctionAggregate> {
    await this.promptBindingRepository.replaceBindings(promptId, payload);
    return this.promptBindingRepository.getPromptFunctions(promptId);
  }

  async invokeFunction(
    functionId: string,
    request: FunctionInvokeRequest
  ): Promise<FunctionInvokeResult> {
    const func = await this.functionRepository.findById(functionId);
    if (!func) {
      throw new Error('Function not found');
    }

    if (!func.enabled) {
      throw new Error('Function is disabled');
    }

    const startedAt = new Date();
    let result: FunctionInvokeResult;

    switch (func.invokeMethod) {
      case 'HTTP':
        result = await this.invokeHttpFunction(func, request, startedAt);
        break;
      case 'INTERNAL':
        result = await this.invokeInternalFunction(func, request, startedAt);
        break;
      case 'GRPC':
        throw new Error('gRPC functions are not implemented yet');
      default:
        throw new Error(`Unsupported invoke method: ${func.invokeMethod}`);
    }

    try {
      await this.executionLogRepository.insert({
        traceId: request.traceId,
        functionId: func.id,
        jobId: request.jobId,
        sourceKey: typeof request.context?.sourceKey === 'string' ? request.context.sourceKey : undefined,
        promptId: typeof request.context?.promptId === 'number' ? request.context.promptId : undefined,
        requestArguments: request.arguments ?? {},
        requestContext: request.context,
        responseData: result.success ? (result.data ?? {}) : undefined,
        errorMessage: result.success ? undefined : result.error,
        status: result.success ? 'success' : 'failed',
        durationMs: result.durationMs,
        startedAt,
        completedAt: new Date()
      });
    } catch (error: any) {
      logger.error('Failed to persist function execution log', {
        error: error.message,
        functionId: func.id
      });
    }

    return result;
  }

  private async invokeHttpFunction(
    func: FunctionDefinition,
    request: FunctionInvokeRequest,
    startedAt: Date
  ): Promise<FunctionInvokeResult> {
    if (!func.invokeUrl) {
      throw new Error('HTTP function missing invokeUrl');
    }

    const axiosConfig: AxiosRequestConfig = {
      url: func.invokeUrl,
      method: func.httpMethod?.toLowerCase() as any || 'post',
      timeout: func.timeoutMs,
      data: request.arguments,
      headers: {
        'Content-Type': 'application/json',
        'X-Trace-Id': request.traceId ?? ''
      }
    };

    try {
      const response = await axios(axiosConfig);
      return {
        success: true,
        data: response.data,
        durationMs: Date.now() - startedAt.getTime()
      };
    } catch (error: any) {
      logger.error('HTTP function invocation failed', {
        functionId: func.id,
        error: error.message
      });

      return {
        success: false,
        error: error.response?.data?.error || error.message,
        durationMs: Date.now() - startedAt.getTime()
      };
    }
  }

  private async invokeInternalFunction(
    func: FunctionDefinition,
    request: FunctionInvokeRequest,
    _startedAt: Date
  ): Promise<FunctionInvokeResult> {
    logger.warn('Internal function invocation not yet implemented', {
      functionId: func.id
    });
    return {
      success: false,
      error: 'Internal function adapter not implemented'
    };
  }
}
