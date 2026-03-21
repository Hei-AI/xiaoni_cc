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
  let replyContextTool: StaticTool | undefined;
  let readAttachmentTool: StaticTool | undefined;
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
      fetchReplyContext: jest.fn().mockResolvedValue({
        status: 'ok',
        reply_to_message_id: 470624549,
        anchor_already_visible: false,
        transcript: '引用消息窗口：群聊 10001',
        reply_anchor_viewport: {
          source_key: 'group_10001',
          source_type: 'group',
          history_table: 'group_message_history',
          source_id: 10001,
          anchor: 'reply_anchor',
          reply_anchor_message_id: 470624549,
          top_history_id: 1,
          bottom_history_id: 21,
          unread_count: 0,
          earlier_unread_count: 0,
          visible_count: 21
        }
      }),
      readMessageAttachment: jest.fn().mockResolvedValue({
        status: 'ok',
        message_id: 470624549,
        attachment_id: 0,
        attachment_type: 'image',
        label: '表情包',
        mime_type: 'image/png',
        media_part: {
          mimeType: 'image/png',
          data: 'QUJDREVGRw=='
        }
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
    replyContextTool = toolsByName.get('reply_context_fetch');
    readAttachmentTool = toolsByName.get('read_message_attachment');
  });

  it('should create both private and group messaging tools', () => {
    const toolNames = Array.from(toolsByName.keys());

    expect(toolNames).toContain('send_private_chat_message');
    expect(toolNames).toContain('send_qq_group_message');
    expect(toolNames).toContain('send_meme_image');
    expect(toolNames).toContain('save_meme_image');
    expect(toolNames).toContain('reply_context_fetch');
    expect(toolNames).toContain('read_message_attachment');
    expect(toolNames).toContain('end');

    expect(privateTool.mode).toBe('fire-and-forget');
    expect(groupTool.mode).toBe('fire-and-forget');
    expect(memeTool.mode).toBe('fire-and-forget');
    expect(saveMemeTool.mode).toBe('fire-and-forget');
    expect(endTool.mode).toBe('fire-and-forget');
    expect(replyContextTool?.mode).toBe('returnable');
    expect(readAttachmentTool?.mode).toBe('returnable');

    toolsByName.forEach(tool => {
      if (tool.parameters) {
        expect(tool.parameters.type).toBe('object');
      }
      expect(typeof tool.handler).toBe('function');
    });

    expect(toolsByName.size).toBe(7);
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

    it('should suppress private message when auto reply is disabled', async () => {
      deps.canSendPrivateMessage = jest.fn().mockResolvedValue(false) as any;

      const result = await privateTool.handler(
        buildContext({ user_id: 123456, message: 'hello world' })
      );

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        status: 'suppressed',
        reason: 'auto_reply_disabled',
        message: 'hello world'
      });
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

    it('should allow missing user_perspectives argument', async () => {
      const result = await groupTool.handler(
        buildContext({ message: 'hi' }, { group_id: 654321 })
      );

      expect(result.success).toBe(true);
      expect(deps.sendGroupMessage).toHaveBeenCalledWith(654321, 'hi');
      expect(result.data).toMatchObject({
        status: 'sent',
        group_id: 654321,
        user_perspectives: []
      });
    });

    it('should fail when group context is missing', async () => {
      const result = await groupTool.handler(
        buildContext({ message: 'hello', user_perspectives: [] })
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
          { tags: ['无语'], at_user_ids: [999], user_perspectives: [] },
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
        buildContext({ tags: ['围观'], user_perspectives: [] }, { user_id: 87654 })
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
        buildContext({ tags: ['不存在'], user_perspectives: [] }, { group_id: 24680 })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('No meme image found');
      expect(deps.sendGroupMessage).not.toHaveBeenCalled();
    });

    it('should reject missing user_perspectives argument for meme tool', async () => {
      const result = await memeTool.handler(
        buildContext({ tags: ['吐槽'] }, { group_id: 24680 })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('user_perspectives');
      expect(deps.sendGroupMessage).not.toHaveBeenCalled();
      expect(deps.sendPrivateMessage).not.toHaveBeenCalled();
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

  describe('chat viewport tools', () => {
    it('should create chat viewport tools when dependencies are provided', () => {
      const tools = createMessagingTools({
        ...deps,
        scrollChatViewUp: jest.fn(),
        jumpChatViewToLatest: jest.fn()
      });
      const toolNames = tools.map(tool => tool.name);

      expect(toolNames).toContain('chat_view_scroll_up');
      expect(toolNames).toContain('chat_view_jump_to_latest');
      expect(toolNames).toContain('reply_context_fetch');
      expect(toolNames).toContain('read_message_attachment');
    });

    it('should return transcript and metadata patch when scrolling up', async () => {
      const scrollChatViewUp = jest.fn().mockResolvedValue({
        header_lines: ['当前窗口：与 QQ 123 的私聊'],
        visible_messages: [
          {
            history_id: 11,
            sender_id: 123,
            sender_role: 'user',
            content: '更早消息',
            content_type: 'text',
            sent_at: '2026-03-21T00:00:00.000Z',
            raw_payload: { sender: { nickname: '李阿花' } }
          }
        ],
        cursor: {
          source_key: 'user_123',
          source_type: 'private',
          history_table: 'private_message_history',
          source_id: 123,
          anchor: 'scroll',
          top_history_id: 11,
          bottom_history_id: 18,
          unread_count: 3,
          earlier_unread_count: 2,
          visible_count: 8
        }
      });

      const tools = createMessagingTools({
        ...deps,
        scrollChatViewUp,
        jumpChatViewToLatest: jest.fn()
      });
      const tool = tools.find(item => item.name === 'chat_view_scroll_up')!;

      const result = await tool.handler(
        buildContext(
          { page_size: 5 },
          {
            metadata: {
              chatViewport: {
                source_key: 'user_123',
                source_type: 'private',
                history_table: 'private_message_history',
                source_id: 123,
                top_history_id: 18,
                bottom_history_id: 25
              }
            }
          }
        )
      );

      expect(scrollChatViewUp).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        status: 'ok',
        page_size: 5
      });
      expect(result.data.transcript).toContain('当前窗口：与 QQ 123 的私聊');
      expect(result.data.__job_metadata_patch).toMatchObject({
        chatViewport: {
          top_history_id: 11
        }
      });
    });

    it('should scroll reply anchor viewport when target=reply_anchor', async () => {
      const scrollChatViewUp = jest.fn().mockResolvedValue({
        header_lines: ['引用消息窗口：群聊 10001'],
        visible_messages: [],
        cursor: {
          source_key: 'group_10001',
          source_type: 'group',
          history_table: 'group_message_history',
          source_id: 10001,
          anchor: 'reply_anchor',
          reply_anchor_message_id: 470624549,
          top_history_id: 4,
          bottom_history_id: 24,
          unread_count: 0,
          earlier_unread_count: 0,
          visible_count: 21
        }
      });

      const tools = createMessagingTools({
        ...deps,
        scrollChatViewUp,
        jumpChatViewToLatest: jest.fn()
      });
      const tool = tools.find(item => item.name === 'chat_view_scroll_up')!;

      const result = await tool.handler(
        buildContext(
          { page_size: 6, target: 'reply_anchor' },
          {
            metadata: {
              replyAnchorViewport: {
                source_key: 'group_10001',
                source_type: 'group',
                history_table: 'group_message_history',
                source_id: 10001,
                anchor: 'reply_anchor',
                reply_anchor_message_id: 470624549,
                top_history_id: 10,
                bottom_history_id: 30
              }
            }
          }
        )
      );

      expect(scrollChatViewUp).toHaveBeenCalledWith(
        expect.objectContaining({
          anchor: 'reply_anchor',
          reply_anchor_message_id: 470624549
        }),
        6
      );
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        target: 'reply_anchor'
      });
      expect(result.data.__job_metadata_patch).toMatchObject({
        replyAnchorViewport: {
          top_history_id: 4
        }
      });
    });
  });

  describe('reply_context_fetch', () => {
    it('should return reply context and patch reply anchor metadata', async () => {
      expect(replyContextTool).toBeDefined();

      const result = await replyContextTool!.handler(
        buildContext({}, {
          metadata: {
            replyIntentContext: {
              message_kind: 'directed_reply'
            }
          }
        })
      );

      expect(deps.fetchReplyContext).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        status: 'ok',
        reply_to_message_id: 470624549,
        transcript: '引用消息窗口：群聊 10001'
      });
      expect(result.data.__job_metadata_patch).toMatchObject({
        replyAnchorViewport: {
          anchor: 'reply_anchor',
          reply_anchor_message_id: 470624549
        }
      });
    });
  });

  describe('read_message_attachment', () => {
    it('should return attachment metadata and multimodal followup content', async () => {
      expect(readAttachmentTool).toBeDefined();

      const result = await readAttachmentTool!.handler(
        buildContext({
          message_id: 470624549,
          attachment_id: 0
        })
      );

      expect(deps.readMessageAttachment).toHaveBeenCalledWith({
        metadata: undefined,
        messageId: 470624549,
        attachmentId: 0,
        attachmentIndex: undefined
      });
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        status: 'ok',
        message_id: 470624549,
        attachment_id: 0,
        attachment_type: 'image',
        media_loaded: true
      });
      expect(result.data.__tool_followup_contents).toHaveLength(1);
      expect(result.data.__tool_followup_contents[0].parts[1]).toEqual({
        inlineData: {
          mimeType: 'image/png',
          data: 'QUJDREVGRw=='
        }
      });
    });

    it('should reject missing attachment selector', async () => {
      const result = await readAttachmentTool!.handler(
        buildContext({
          message_id: 470624549
        })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('attachment_id or attachment_index');
    });
  });
});
