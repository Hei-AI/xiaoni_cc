/**
 * 静态消息工具测试
 */

import { createMessagingTools, MessagingToolDependencies } from '../../tools/static-tools';
import { StaticTool, ToolContext } from '../../types';

jest.mock('../../utils/logger', () => ({
  logger: {
    createModuleLogger: jest.fn(() => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    }))
  }
}));

describe('Messaging Static Tools', () => {
  let deps: jest.Mocked<MessagingToolDependencies>;
  let privateTool: StaticTool;
  let groupTool: StaticTool;
  let memeTool: StaticTool;
  let saveMemeTool: StaticTool;
  let endTool: StaticTool;
  let toolsByName: Map<string, StaticTool>;

  const buildContext = (
    args: Record<string, unknown> = {},
    overrides: Partial<ToolContext> = {}
  ): ToolContext => ({
    trace_id: 'trace-123',
    source_key: 'source_key',
    ...overrides,
    arguments: args
  });

  beforeEach(() => {
    deps = {
      sendPrivateMessage: jest.fn().mockResolvedValue(undefined),
      sendGroupMessage: jest.fn().mockResolvedValue(undefined),
      findMemeByTags: jest.fn().mockResolvedValue(null),
      saveMemeImage: jest.fn().mockResolvedValue({
        id: 'meme-id',
        tags: ['示例'],
        image_base64: 'YmFzZTY0',
        created_at: new Date().toISOString()
      }),
      recordMemeUsage: jest.fn().mockResolvedValue(undefined)
    };

    const tools = createMessagingTools(deps);
    toolsByName = new Map(tools.map(tool => [tool.name, tool]));
    privateTool = toolsByName.get('send_private_chat_message')!;
    groupTool = toolsByName.get('send_qq_group_message')!;
    memeTool = toolsByName.get('send_meme_image')!;
    saveMemeTool = toolsByName.get('save_meme_image')!;
    endTool = toolsByName.get('end')!;
  });

  it('should create both private and group messaging tools', () => {
    const toolNames = Array.from(toolsByName.keys());

    expect(toolNames).toContain('send_private_chat_message');
    expect(toolNames).toContain('send_qq_group_message');
    expect(toolNames).toContain('send_meme_image');
    expect(toolNames).toContain('save_meme_image');
    expect(toolNames).toContain('end');

    toolsByName.forEach(tool => {
      expect(tool.mode).toBe('fire-and-forget');
      if (tool.parameters) {
        expect(tool.parameters.type).toBe('object');
      }
      expect(typeof tool.handler).toBe('function');
    });

    expect(toolsByName.size).toBe(5);
  });

  describe('send_private_chat_message', () => {
    it('should send private message successfully', async () => {
      const result = await privateTool.handler(
        buildContext({ user_id: 123456, message: 'hello world' })
      );

      expect(deps.sendPrivateMessage).toHaveBeenCalledWith(123456, 'hello world');
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        status: 'sent',
        user_id: 123456,
        message: 'hello world'
      });
    });

    it('should reject invalid user id', async () => {
      const result = await privateTool.handler(
        buildContext({ user_id: 'foo', message: 'hello world' })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('user_id');
      expect(deps.sendPrivateMessage).not.toHaveBeenCalled();
    });

    it('should reject empty message', async () => {
      const result = await privateTool.handler(
        buildContext({ user_id: 123456, message: '   ' })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('message');
      expect(deps.sendPrivateMessage).not.toHaveBeenCalled();
    });
  });

  describe('send_qq_group_message', () => {
    it('should send group message without mention', async () => {
      const result = await groupTool.handler(
        buildContext({ message: 'broadcast' }, { group_id: 654321 })
      );

      expect(deps.sendGroupMessage).toHaveBeenCalledWith(654321, 'broadcast');
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        status: 'sent',
        group_id: 654321,
        mention: { enabled: false }
      });
    });

    it('should send group message with @ mention', async () => {
      const result = await groupTool.handler(
        buildContext({
          message: 'hi',
          at_user_ids: [111, 222]
        }, { group_id: 654321 })
      );

      expect(deps.sendGroupMessage).toHaveBeenCalledWith(
        654321,
        '[CQ:at,qq=111] [CQ:at,qq=222] hi'
      );
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        status: 'sent',
        group_id: 654321,
        mention: { enabled: true, user_ids: [111, 222] }
      });
    });

    it('should reject invalid at_user_ids input', async () => {
      const result = await groupTool.handler(
        buildContext({
          message: 'hi',
          at_user_ids: '111'
        }, { group_id: 654321 })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('at_user_ids');
      expect(deps.sendGroupMessage).not.toHaveBeenCalled();
    });

    it('should fail when group context is missing', async () => {
      const result = await groupTool.handler(
        buildContext({ message: 'hello' })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('group_id');
      expect(deps.sendGroupMessage).not.toHaveBeenCalled();
    });
  });

  describe('send_meme_image', () => {
    beforeEach(() => {
      deps.findMemeByTags.mockResolvedValue({
        id: 'meme-001',
        tags: ['无语'],
        image_base64: 'QUJDREVGRw==',
        created_at: new Date().toISOString(),
        usage_count: 0
      });
    });

    it('should send meme image in group context', async () => {
      const result = await memeTool.handler(
        buildContext(
          { tags: ['无语'], at_user_ids: [999] },
          { group_id: 12345 }
        )
      );

      expect(deps.findMemeByTags).toHaveBeenCalledWith(['无语']);
      expect(deps.sendGroupMessage).toHaveBeenCalledWith(
        12345,
        '[CQ:at,qq=999] [CQ:image,file=base64://QUJDREVGRw==]'
      );
      expect(deps.recordMemeUsage).toHaveBeenCalledWith('meme-001');
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        status: 'sent',
        meme_id: 'meme-001',
        at_user_ids: [999]
      });
    });

    it('should send meme image in private context when group is missing', async () => {
      const result = await memeTool.handler(
        buildContext({ tags: ['围观'] }, { user_id: 87654 })
      );

      expect(deps.sendPrivateMessage).toHaveBeenCalledWith(
        87654,
        '[CQ:image,file=base64://QUJDREVGRw==]'
      );
      expect(result.success).toBe(true);
    });

    it('should fail when meme is not found', async () => {
      deps.findMemeByTags.mockResolvedValueOnce(null);

      const result = await memeTool.handler(
        buildContext({ tags: ['不存在'] }, { group_id: 24680 })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('No meme image found');
      expect(deps.sendGroupMessage).not.toHaveBeenCalled();
    });
  });

  describe('save_meme_image', () => {
    it('should store meme image successfully', async () => {
      const result = await saveMemeTool.handler(
        buildContext({
          image_base64: 'QUJDREVGRw==',
          tags: ['围观', '吃瓜']
        })
      );

      expect(result.success).toBe(true);
      expect(deps.saveMemeImage).toHaveBeenCalledTimes(1);
      expect(deps.saveMemeImage).toHaveBeenCalledWith('QUJDREVGRw==', ['围观', '吃瓜']);
      expect(result.data?.status).toBe('stored');
    });

    it('should reject invalid base64', async () => {
      const result = await saveMemeTool.handler(
        buildContext({
          image_base64: 'not-base64***',
          tags: ['围观']
        })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('image_base64');
      expect(deps.saveMemeImage).not.toHaveBeenCalled();
    });
  });

  describe('end', () => {
    it('should succeed without producing output or side effects', async () => {
      const result = await endTool.handler(buildContext());

      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
      expect(result.error).toBeUndefined();
      expect(deps.sendPrivateMessage).not.toHaveBeenCalled();
      expect(deps.sendGroupMessage).not.toHaveBeenCalled();
      expect(deps.findMemeByTags).not.toHaveBeenCalled();
    });
  });
});
