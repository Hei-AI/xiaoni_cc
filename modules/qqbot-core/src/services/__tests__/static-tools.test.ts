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

  const buildContext = (args: Record<string, unknown>): ToolContext => ({
    trace_id: 'trace-123',
    source_key: 'source_key',
    arguments: args
  });

  beforeEach(() => {
    deps = {
      sendPrivateMessage: jest.fn().mockResolvedValue(undefined),
      sendGroupMessage: jest.fn().mockResolvedValue(undefined),
      sendAtMessage: jest.fn().mockResolvedValue(undefined)
    };

    const tools = createMessagingTools(deps);
    [privateTool, groupTool] = tools;
  });

  it('should create both private and group messaging tools', () => {
    const toolNames = [privateTool.name, groupTool.name];

    expect(toolNames).toContain('send_private_chat_message');
    expect(toolNames).toContain('send_group_chat_message');

    [privateTool, groupTool].forEach(tool => {
      expect(tool.mode).toBe('fire-and-forget');
      expect(tool.parameters.type).toBe('object');
      expect(typeof tool.handler).toBe('function');
    });
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

  describe('send_group_chat_message', () => {
    it('should send group message without mention', async () => {
      const result = await groupTool.handler(
        buildContext({ group_id: 654321, message: 'broadcast' })
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
          group_id: 654321,
          message: 'hi',
          should_at: true,
          at_user_id: 111
        })
      );

      expect(deps.sendAtMessage).toHaveBeenCalledWith(654321, 111, 'hi');
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        status: 'sent',
        group_id: 654321,
        mention: { enabled: true, user_id: 111 }
      });
      expect(deps.sendGroupMessage).not.toHaveBeenCalled();
    });

    it('should reject missing user id when mention is requested', async () => {
      const result = await groupTool.handler(
        buildContext({
          group_id: 654321,
          message: 'hi',
          should_at: true
        })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('at_user_id');
      expect(deps.sendAtMessage).not.toHaveBeenCalled();
    });
  });
});
