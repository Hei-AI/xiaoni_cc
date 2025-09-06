/**
 * Stage 1 Engine Test Data
 * 测试数据和Mock消息场景
 */

import { QQMessage, MessageContext, UserInfo, GroupInfo } from '../../src/types';

// Mock QQ Messages for testing
export const mockMessages = {
  // 技术问题 - 应该触发回复
  technical: {
    message_type: 'private',
    sub_type: 'friend',
    message_id: 12345,
    user_id: 123456789,
    message: '我的TypeScript代码出现bug了，能帮我分析一下吗？',
    raw_message: '我的TypeScript代码出现bug了，能帮我分析一下吗？',
    font: 0,
    sender: {
      user_id: 123456789,
      nickname: 'TechUser',
      sex: 'unknown' as const,
    },
    time: Math.floor(Date.now() / 1000),
    self_id: 987654321,
    post_type: 'message' as const,
  } as QQMessage,

  // 普通闲聊 - 可能回复
  casual: {
    message_type: 'private',
    sub_type: 'friend', 
    message_id: 12346,
    user_id: 123456790,
    message: '今天天气真不错呢',
    raw_message: '今天天气真不错呢',
    font: 0,
    sender: {
      user_id: 123456790,
      nickname: 'CasualUser',
      sex: 'unknown' as const,
    },
    time: Math.floor(Date.now() / 1000),
    self_id: 987654321,
    post_type: 'message' as const,
  } as QQMessage,

  // 需求描述 - 应该建议requirement服务
  requirement: {
    message_type: 'private',
    sub_type: 'friend',
    message_id: 12347, 
    user_id: 123456789, // 授权用户
    message: '我需要实现一个用户登录功能，包含JWT认证、密码加密、权限管理，还要支持多设备登录和单点登录功能',
    raw_message: '我需要实现一个用户登录功能，包含JWT认证、密码加密、权限管理，还要支持多设备登录和单点登录功能',
    font: 0,
    sender: {
      user_id: 123456789,
      nickname: 'DevUser',
      sex: 'unknown' as const,
    },
    time: Math.floor(Date.now() / 1000),
    self_id: 987654321,
    post_type: 'message' as const,
  } as QQMessage,

  // 群聊@消息
  groupMention: {
    message_type: 'group',
    sub_type: 'normal',
    message_id: 12348,
    user_id: 123456791,
    group_id: 987654,
    message: '[CQ:at,qq=987654321] 你好，请问这个问题怎么解决？',
    raw_message: '[CQ:at,qq=987654321] 你好，请问这个问题怎么解决？',
    font: 0,
    sender: {
      user_id: 123456791,
      nickname: 'GroupUser',
      sex: 'unknown' as const,
      card: '群成员A',
      role: 'member' as const,
    },
    time: Math.floor(Date.now() / 1000),
    self_id: 987654321,
    post_type: 'message' as const,
  } as QQMessage,

  // 空消息 - 不应该回复
  empty: {
    message_type: 'private',
    sub_type: 'friend',
    message_id: 12349,
    user_id: 123456792,
    message: '',
    raw_message: '',
    font: 0,
    sender: {
      user_id: 123456792,
      nickname: 'EmptyUser',
      sex: 'unknown' as const,
    },
    time: Math.floor(Date.now() / 1000),
    self_id: 987654321,
    post_type: 'message' as const,
  } as QQMessage,

  // 垃圾信息 - 不应该回复
  spam: {
    message_type: 'private',
    sub_type: 'friend',
    message_id: 12350,
    user_id: 999999999, // 非授权用户
    message: 'asdfghjkl',
    raw_message: 'asdfghjkl',
    font: 0,
    sender: {
      user_id: 999999999,
      nickname: 'SpamUser',
      sex: 'unknown' as const,
    },
    time: Math.floor(Date.now() / 1000),
    self_id: 987654321,
    post_type: 'message' as const,
  } as QQMessage,
};

// Mock Users
export const mockUsers = {
  authorized: {
    user_id: 123456789,
    nickname: 'AuthorizedUser',
    recent_interaction_count: 50,
    last_interaction: new Date(Date.now() - 3600000), // 1 hour ago
    is_frequent_user: true,
  } as UserInfo,

  newUser: {
    user_id: 123456790,
    nickname: 'NewUser',
    recent_interaction_count: 0,
    is_frequent_user: false,
  } as UserInfo,

  frequentUser: {
    user_id: 123456791,
    nickname: 'FrequentUser', 
    recent_interaction_count: 100,
    last_interaction: new Date(Date.now() - 300000), // 5 minutes ago
    is_frequent_user: true,
  } as UserInfo,

  spamUser: {
    user_id: 999999999,
    nickname: 'SpamUser',
    recent_interaction_count: 0,
    is_frequent_user: false,
  } as UserInfo,
};

// Mock Group Info
export const mockGroups = {
  activeGroup: {
    group_id: 987654,
    recent_activity_level: 'high' as const,
    participant_count: 50,
    current_topic_hint: '技术讨论',
  } as GroupInfo,

  quietGroup: {
    group_id: 987655,
    recent_activity_level: 'low' as const,
    participant_count: 20,
  } as GroupInfo,
};

// Mock Message Contexts
export const mockContexts = {
  technicalContext: {
    currentMessage: mockMessages.technical,
    recentMessages: [mockMessages.technical],
    userInfo: mockUsers.authorized,
    conversationSummary: '正在讨论技术问题',
    topicKeywords: ['bug', 'TypeScript', '代码', '分析'],
  } as MessageContext,

  casualContext: {
    currentMessage: mockMessages.casual,
    recentMessages: [mockMessages.casual],
    userInfo: mockUsers.newUser,
    conversationSummary: '日常闲聊',
    topicKeywords: ['天气'],
  } as MessageContext,

  requirementContext: {
    currentMessage: mockMessages.requirement,
    recentMessages: [mockMessages.requirement],
    userInfo: mockUsers.authorized,
    conversationSummary: '描述开发需求',
    topicKeywords: ['实现', '用户登录', 'JWT', '认证', '权限', '管理'],
  } as MessageContext,

  groupContext: {
    currentMessage: mockMessages.groupMention,
    recentMessages: [mockMessages.groupMention],
    userInfo: mockUsers.frequentUser,
    groupInfo: mockGroups.activeGroup,
    conversationSummary: '群聊讨论',
    topicKeywords: ['问题', '解决'],
  } as MessageContext,

  spamContext: {
    currentMessage: mockMessages.spam,
    recentMessages: [mockMessages.spam],
    userInfo: mockUsers.spamUser,
    conversationSummary: '无意义内容',
    topicKeywords: [],
  } as MessageContext,
};

// Test configuration constants
export const testConfig = {
  authorizedUserId: 123456789,
  botQQNumber: 987654321,
  testApiKeys: ['test-key-1', 'test-key-2'],
  modelName: 'gemini-2.0-flash-exp',
};