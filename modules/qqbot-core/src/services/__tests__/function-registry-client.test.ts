import axios from 'axios';
import {
  FunctionRegistryClient,
  RegistryFunctionUpsertPayload
} from '../function-registry-client';

jest.mock('axios');

describe('FunctionRegistryClient', () => {
  const mockedAxiosCreate = axios.create as jest.MockedFunction<typeof axios.create>;
  let mockGet: jest.Mock;
  let mockPost: jest.Mock;
  let mockPatch: jest.Mock;

  const buildPayload = (): RegistryFunctionUpsertPayload => ({
    name: 'test_static_tool',
    displayName: 'Test Static Tool',
    description: 'desc',
    parametersSchema: { type: 'object' },
    sideEffect: false,
    expectResponse: true,
    category: 'testing',
    tags: ['unit'],
    invokeMethod: 'INTERNAL',
    invokeUrl: undefined,
    httpMethod: undefined,
    authType: 'NONE',
    timeoutMs: 2000,
    retryPolicy: undefined,
    executionAdapter: undefined,
    managedBySystem: true,
    enabled: true,
    createdBy: 'system',
    updatedBy: 'system'
  });

  beforeEach(() => {
    mockGet = jest.fn();
    mockPost = jest.fn();
    mockPatch = jest.fn();
    mockedAxiosCreate.mockReturnValue({
      get: mockGet,
      post: mockPost,
      patch: mockPatch
    } as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns null for lookups and upserts when disabled', async () => {
    const client = new FunctionRegistryClient({
      base_url: 'http://localhost:8080/v1',
      timeout_ms: 1000,
      enabled: false
    });

    expect(client.isEnabled()).toBe(false);
    await expect(client.getFunctionsForPrompt('123')).resolves.toBeNull();
    await expect(
      client.invokeFunction('test-function', {
        arguments: {}
      })
    ).resolves.toBeNull();
    await expect(client.upsertFunctionDefinition(buildPayload())).resolves.toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('creates function definition when none exists', async () => {
    const client = new FunctionRegistryClient({
      base_url: 'http://localhost:8080/v1',
      timeout_ms: 1000,
      enabled: true
    });

    const payload = buildPayload();
    mockGet.mockResolvedValue({ data: { items: [], total: 0 } });
    mockPost.mockResolvedValue({
      data: {
        id: 'fn-1',
        ...payload,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    });

    await client.upsertFunctionDefinition(payload);

    expect(mockGet).toHaveBeenCalledWith('/functions', {
      params: { search: payload.name, limit: 1, page: 1 }
    });
    expect(mockPost).toHaveBeenCalledWith('/functions', expect.objectContaining({
      name: payload.name,
      displayName: payload.displayName,
      parametersSchema: payload.parametersSchema,
      invokeMethod: 'INTERNAL',
      authType: 'NONE',
      managedBySystem: true,
      createdBy: payload.createdBy
    }));
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('updates function definition when already exists', async () => {
    const client = new FunctionRegistryClient({
      base_url: 'http://localhost:8080/v1',
      timeout_ms: 1000,
      enabled: true
    });

    const payload = buildPayload();
    const existing = {
      id: 'fn-2',
      name: payload.name,
      displayName: 'Old',
      description: 'old',
      parametersSchema: {},
      sideEffect: false,
      expectResponse: true,
      category: 'old',
      tags: [],
      invokeMethod: 'INTERNAL',
      invokeUrl: null,
      httpMethod: null,
      authType: 'NONE',
      timeoutMs: 1000,
      retryPolicy: null,
      executionAdapter: null,
      managedBySystem: true,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    mockGet.mockResolvedValue({ data: { items: [existing], total: 1 } });
    mockPatch.mockResolvedValue({
      data: { ...existing, displayName: payload.displayName }
    });

    await client.upsertFunctionDefinition(payload);

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockPatch).toHaveBeenCalledWith(
      `/functions/${existing.id}`,
      expect.objectContaining({
        displayName: payload.displayName,
        updatedBy: payload.updatedBy
      })
    );
  });
});
