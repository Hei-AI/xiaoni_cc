/**
 * Database Manager Mock for Testing
 * 模拟数据库操作
 */

export class MockDatabaseManager {
  private shouldFail: boolean = false;
  private mockUsers: Map<number, any> = new Map();
  private mockGroups: Map<number, any> = new Map();

  constructor() {
    // Initialize with some test data
    this.mockUsers.set(123456789, {
      user_id: 123456789,
      nickname: 'AuthorizedUser',
      interaction_count: 50,
      last_interaction: new Date(Date.now() - 3600000),
      is_frequent_user: true,
    });

    this.mockUsers.set(123456790, {
      user_id: 123456790,
      nickname: 'NewUser', 
      interaction_count: 0,
      is_frequent_user: false,
    });

    this.mockGroups.set(987654, {
      group_id: 987654,
      group_name: '技术交流群',
      is_enabled: true,
      auto_reply_enabled: true,
      member_count: 50,
    });
  }

  async testConnection(): Promise<boolean> {
    if (this.shouldFail) {
      return false;
    }
    return true;
  }

  // Mock user operations
  async getUserProfile(userId: number) {
    if (this.shouldFail) {
      throw new Error('Mock database connection failed');
    }

    return this.mockUsers.get(userId) || null;
  }

  async updateUserActivity(userId: number, increment: number = 1) {
    if (this.shouldFail) {
      throw new Error('Mock database update failed');
    }

    const user = this.mockUsers.get(userId);
    if (user) {
      user.interaction_count += increment;
      user.last_interaction = new Date();
      user.is_frequent_user = user.interaction_count > 10;
    }
    return true;
  }

  // Mock group operations
  async getGroupChatSettingById(groupId: number) {
    if (this.shouldFail) {
      throw new Error('Mock database query failed');
    }

    return this.mockGroups.get(groupId) || null;
  }

  async updateGroupActivity(groupId: number, messageIncrement: number, aiResponseIncrement: number) {
    if (this.shouldFail) {
      throw new Error('Mock database update failed');
    }

    const group = this.mockGroups.get(groupId);
    if (group) {
      group.message_count = (group.message_count || 0) + messageIncrement;
      group.ai_response_count = (group.ai_response_count || 0) + aiResponseIncrement;
      group.last_activity = new Date();
    }
    return true;
  }

  // Mock message operations (for ContextEngine)
  async getRecentMessages(params: {
    user_id: number;
    group_id?: number;
    after_time: Date;
    limit: number;
  }) {
    if (this.shouldFail) {
      throw new Error('Mock database query failed');
    }

    // Return empty array for Stage 1 simplification
    return [];
  }

  async saveConversation(conversation: any) {
    if (this.shouldFail) {
      throw new Error('Mock database save failed');
    }
    return true;
  }

  // Mock bot status operations
  async updateBotStatus(botId: string, status: string, isConnected: boolean, isHealthy: boolean) {
    if (this.shouldFail) {
      throw new Error('Mock database update failed');
    }
    return true;
  }

  async close() {
    // Mock cleanup
    return Promise.resolve();
  }

  // Test helpers
  setShouldFail(shouldFail: boolean) {
    this.shouldFail = shouldFail;
  }

  addMockUser(userId: number, userData: any) {
    this.mockUsers.set(userId, userData);
  }

  addMockGroup(groupId: number, groupData: any) {
    this.mockGroups.set(groupId, groupData);
  }

  clearMockData() {
    this.mockUsers.clear();
    this.mockGroups.clear();
  }

  getMockUserData() {
    return Array.from(this.mockUsers.entries());
  }

  getMockGroupData() {
    return Array.from(this.mockGroups.entries());
  }
}