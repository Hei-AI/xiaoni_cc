import { DatabaseManager } from './database';
import {
  ChatViewportCursor,
  ChatViewportData,
  ChatViewportHistoryTable,
  ChatViewportSourceType,
  ContextHistoryMessage,
  QQMessage
} from '../types';
import { logger } from '../utils/logger';

type HistoryRow = {
  id: number;
  conversation_id?: string | null;
  message_id?: number | null;
  group_id?: number;
  user_id?: number;
  sender_id: number;
  sender_role: 'user' | 'bot' | 'system';
  content: string;
  content_type: 'text' | 'image' | 'audio' | 'video';
  sent_at: string | Date;
  raw_payload?: any;
};

const DEFAULT_VIEWPORT_SIZE = 8;
const DEFAULT_GROUP_CONTEXT_BEFORE = 5;
const DEFAULT_GROUP_CONTEXT_AFTER = 1;
const DEFAULT_REPLY_CONTEXT_BEFORE = 10;
const DEFAULT_REPLY_CONTEXT_AFTER = 10;

export class ChatViewportService {
  private database: DatabaseManager;
  private moduleLogger = logger.createModuleLogger('chat-viewport-service');
  private attentionTableEnsured = false;

  constructor(database: DatabaseManager) {
    this.database = database;
  }

  public async buildViewportForMessage(message: QQMessage): Promise<ChatViewportData> {
    await this.ensureAttentionTable();

    if (message.message_type === 'group' && message.group_id) {
      return this.buildGroupTriggerViewport(message.group_id, message.message_id);
    }

    return this.buildPrivateLatestViewport(message.user_id);
  }

  public async buildReplyAnchorViewport(params: {
    messageType: 'private' | 'group';
    userId: number;
    groupId?: number;
    replyMessageId: number;
  }): Promise<ChatViewportData | null> {
    await this.ensureAttentionTable();

    const source = this.resolveSourceDescriptor(params.messageType, params.userId, params.groupId);
    if (!source) {
      return null;
    }

    return this.buildReplyAnchorViewportForSource(
      source.historyTable,
      source.sourceType,
      source.sourceId,
      params.replyMessageId
    );
  }

  public async isMessageVisible(
    cursor: ChatViewportCursor,
    messageId: number
  ): Promise<boolean> {
    await this.ensureAttentionTable();

    if (!cursor?.history_table || !cursor?.source_type || !cursor?.source_id) {
      return false;
    }

    const anchorRow = await this.findAnchorRow(
      cursor.history_table,
      cursor.source_type,
      cursor.source_id,
      messageId
    );

    if (!anchorRow) {
      return false;
    }

    const topHistoryId = cursor.top_history_id ?? anchorRow.id;
    const bottomHistoryId = cursor.bottom_history_id ?? anchorRow.id;
    return anchorRow.id >= topHistoryId && anchorRow.id <= bottomHistoryId;
  }

  public async scrollUp(
    cursor: ChatViewportCursor,
    pageSize: number = DEFAULT_VIEWPORT_SIZE
  ): Promise<ChatViewportData> {
    await this.ensureAttentionTable();

    const normalizedPageSize = this.normalizePageSize(pageSize);
    const sourceColumn = cursor.source_type === 'group' ? 'group_id' : 'user_id';
    const orderIndex = this.getHistoryOrderIndex(cursor.history_table);

    if (!cursor.top_history_id) {
      return this.jumpToLatest(cursor, normalizedPageSize);
    }

    const olderRows = await this.queryRows(
      `
        SELECT *
        FROM ${cursor.history_table} FORCE INDEX (${orderIndex})
        WHERE ${sourceColumn} = ?
          AND id < ?
        ORDER BY id DESC
        LIMIT ${normalizedPageSize}
      `,
      [cursor.source_id, cursor.top_history_id]
    );

    const currentRows = await this.queryRows(
      `
        SELECT *
        FROM ${cursor.history_table} FORCE INDEX (${orderIndex})
        WHERE ${sourceColumn} = ?
          AND id >= ?
          AND id <= ?
        ORDER BY id ASC
      `,
      [cursor.source_id, cursor.top_history_id, cursor.bottom_history_id ?? cursor.top_history_id]
    );

    const visibleRows = [...olderRows.reverse(), ...currentRows];
    return this.finalizeViewport({
      historyTable: cursor.history_table,
      sourceType: cursor.source_type,
      sourceId: cursor.source_id,
      anchor: 'scroll',
      rows: visibleRows
    });
  }

  public async jumpToLatest(
    cursor: ChatViewportCursor,
    pageSize: number = DEFAULT_VIEWPORT_SIZE
  ): Promise<ChatViewportData> {
    await this.ensureAttentionTable();

    if (cursor.anchor === 'reply_anchor' && cursor.reply_anchor_message_id) {
      const replyViewport = await this.buildReplyAnchorViewportForSource(
        cursor.history_table,
        cursor.source_type,
        cursor.source_id,
        cursor.reply_anchor_message_id
      );
      if (replyViewport) {
        return replyViewport;
      }
    }

    if (cursor.source_type === 'group') {
      return this.buildLatestViewport(
        'group_message_history',
        'group',
        cursor.source_id,
        normalizedGroupHeader(cursor.source_id),
        pageSize
      );
    }

    return this.buildLatestViewport(
      'private_message_history',
      'private',
      cursor.source_id,
      normalizedPrivateHeader(cursor.source_id),
      pageSize
    );
  }

  private async buildPrivateLatestViewport(
    userId: number,
    pageSize: number = DEFAULT_VIEWPORT_SIZE
  ): Promise<ChatViewportData> {
    return this.buildLatestViewport(
      'private_message_history',
      'private',
      userId,
      normalizedPrivateHeader(userId),
      pageSize
    );
  }

  private async buildLatestViewport(
    historyTable: ChatViewportHistoryTable,
    sourceType: ChatViewportSourceType,
    sourceId: number,
    title: string,
    pageSize: number
  ): Promise<ChatViewportData> {
    const sourceColumn = sourceType === 'group' ? 'group_id' : 'user_id';
    const orderIndex = this.getHistoryOrderIndex(historyTable);
    const rows = await this.queryRows(
      `
        SELECT *
        FROM ${historyTable} FORCE INDEX (${orderIndex})
        WHERE ${sourceColumn} = ?
        ORDER BY id DESC
        LIMIT ${this.normalizePageSize(pageSize)}
      `,
      [sourceId]
    );

    return this.finalizeViewport({
      historyTable,
      sourceType,
      sourceId,
      anchor: 'latest',
      rows: rows.reverse(),
      title
    });
  }

  private async buildGroupTriggerViewport(
    groupId: number,
    anchorMessageId?: number | null
  ): Promise<ChatViewportData> {
    const anchorRow = anchorMessageId
      ? await this.findGroupAnchorRow(groupId, anchorMessageId)
      : null;

    if (!anchorRow) {
      return this.buildLatestViewport(
        'group_message_history',
        'group',
        groupId,
        normalizedGroupHeader(groupId),
        DEFAULT_VIEWPORT_SIZE
      );
    }

    const beforeRows = await this.queryRows(
      `
        SELECT *
        FROM group_message_history FORCE INDEX (idx_group_history_id)
        WHERE group_id = ?
          AND id <= ?
        ORDER BY id DESC
        LIMIT ${DEFAULT_GROUP_CONTEXT_BEFORE + 1}
      `,
      [groupId, anchorRow.id]
    );

    const afterRows = await this.queryRows(
      `
        SELECT *
        FROM group_message_history FORCE INDEX (idx_group_history_id)
        WHERE group_id = ?
          AND id > ?
        ORDER BY id ASC
        LIMIT ${DEFAULT_GROUP_CONTEXT_AFTER}
      `,
      [groupId, anchorRow.id]
    );

    return this.finalizeViewport({
      historyTable: 'group_message_history',
      sourceType: 'group',
      sourceId: groupId,
      anchor: 'trigger',
      rows: [...beforeRows.reverse(), ...afterRows],
      title: normalizedGroupHeader(groupId)
    });
  }

  private async buildReplyAnchorViewportForSource(
    historyTable: ChatViewportHistoryTable,
    sourceType: ChatViewportSourceType,
    sourceId: number,
    replyMessageId: number
  ): Promise<ChatViewportData | null> {
    const anchorRow = await this.findAnchorRow(
      historyTable,
      sourceType,
      sourceId,
      replyMessageId
    );

    if (!anchorRow) {
      return null;
    }

    const sourceColumn = sourceType === 'group' ? 'group_id' : 'user_id';
    const orderIndex = this.getHistoryOrderIndex(historyTable);
    const beforeRows = await this.queryRows(
      `
        SELECT *
        FROM ${historyTable} FORCE INDEX (${orderIndex})
        WHERE ${sourceColumn} = ?
          AND id < ?
        ORDER BY id DESC
        LIMIT ${DEFAULT_REPLY_CONTEXT_BEFORE}
      `,
      [sourceId, anchorRow.id]
    );
    const afterRows = await this.queryRows(
      `
        SELECT *
        FROM ${historyTable} FORCE INDEX (${orderIndex})
        WHERE ${sourceColumn} = ?
          AND id > ?
        ORDER BY id ASC
        LIMIT ${DEFAULT_REPLY_CONTEXT_AFTER}
      `,
      [sourceId, anchorRow.id]
    );

    return this.finalizeViewport({
      historyTable,
      sourceType,
      sourceId,
      anchor: 'reply_anchor',
      rows: [...beforeRows.reverse(), anchorRow, ...afterRows],
      title: sourceType === 'group'
        ? `引用消息窗口：群聊 ${sourceId}`
        : `引用消息窗口：与 QQ ${sourceId} 的私聊`,
      introLine: `以下是围绕被引用消息 ${replyMessageId} 展开的上下文窗口。`,
      includeUnreadSummary: false,
      replyAnchorMessageId: replyMessageId
    });
  }

  private async findGroupAnchorRow(
    groupId: number,
    messageId: number
  ): Promise<HistoryRow | null> {
    const rows = await this.queryRows(
      `
        SELECT *
        FROM group_message_history FORCE INDEX (idx_group_message_id_lookup)
        WHERE group_id = ?
          AND message_id = ?
        ORDER BY id DESC
        LIMIT 1
      `,
      [groupId, messageId]
    );

    return rows[0] || null;
  }

  private async findPrivateAnchorRow(
    userId: number,
    messageId: number
  ): Promise<HistoryRow | null> {
    const rows = await this.queryRows(
      `
        SELECT *
        FROM private_message_history FORCE INDEX (idx_private_message_id_lookup)
        WHERE user_id = ?
          AND message_id = ?
        ORDER BY id DESC
        LIMIT 1
      `,
      [userId, messageId]
    );

    return rows[0] || null;
  }

  private async findAnchorRow(
    historyTable: ChatViewportHistoryTable,
    sourceType: ChatViewportSourceType,
    sourceId: number,
    messageId: number
  ): Promise<HistoryRow | null> {
    if (historyTable === 'group_message_history' || sourceType === 'group') {
      return this.findGroupAnchorRow(sourceId, messageId);
    }

    return this.findPrivateAnchorRow(sourceId, messageId);
  }

  private getHistoryOrderIndex(historyTable: ChatViewportHistoryTable): string {
    return historyTable === 'group_message_history'
      ? 'idx_group_history_id'
      : 'idx_user_history_id';
  }

  private async finalizeViewport(params: {
    historyTable: ChatViewportHistoryTable;
    sourceType: ChatViewportSourceType;
    sourceId: number;
    anchor: 'latest' | 'trigger' | 'scroll' | 'reply_anchor';
    rows: HistoryRow[];
    title?: string;
    introLine?: string;
    includeUnreadSummary?: boolean;
    replyAnchorMessageId?: number;
  }): Promise<ChatViewportData> {
    const {
      historyTable,
      sourceType,
      sourceId,
      anchor,
      rows,
      title,
      introLine,
      includeUnreadSummary = true,
      replyAnchorMessageId
    } = params;
    const sourceKey = `${sourceType === 'group' ? 'group' : 'user'}_${sourceId}`;
    const historyIds = rows.map(row => row.id);
    const attendedIds = historyIds.length > 0
      ? await this.getAttendedHistoryIds(historyTable, historyIds)
      : new Set<number>();
    const unreadCount = await this.countUnreadMessages(historyTable, sourceType, sourceId);
    const visibleUnreadCount = rows.filter(row => !attendedIds.has(row.id)).length;
    const earlierUnreadCount = Math.max(0, unreadCount - visibleUnreadCount);
    const firstUnreadRow = rows.find(row => !attendedIds.has(row.id));
    const visibleMessages = rows.map(row => this.toContextHistoryMessage(row));

    if (historyIds.length > 0) {
      await this.recordAttentionEvents({
        historyTable,
        sourceKey,
        sourceType,
        sourceId,
        historyIds
      });
    }

    const headerLines = [
      title || (sourceType === 'group'
        ? normalizedGroupHeader(sourceId)
        : normalizedPrivateHeader(sourceId)),
      introLine || (sourceType === 'group'
        ? '你是通过提醒打开到当前聊天片段。'
        : '你当前打开的是最新消息位置。')
    ];

    if (includeUnreadSummary) {
      if (earlierUnreadCount > 0) {
        headerLines.push(`右上角未读：${earlierUnreadCount} 条更早未查看消息`);
      } else if (visibleUnreadCount > 0) {
        headerLines.push(`右上角未读：${visibleUnreadCount} 条`);
      }
    }

    return {
      header_lines: headerLines,
      visible_messages: visibleMessages,
      divider_before_history_id: firstUnreadRow?.id,
      cursor: {
        source_key: sourceKey,
        source_type: sourceType,
        history_table: historyTable,
        source_id: sourceId,
        anchor,
        reply_anchor_message_id: replyAnchorMessageId ?? null,
        top_history_id: rows[0]?.id ?? null,
        bottom_history_id: rows[rows.length - 1]?.id ?? null,
        unread_count: unreadCount,
        earlier_unread_count: earlierUnreadCount,
        visible_count: rows.length
      }
    };
  }

  private async queryRows(query: string, params: any[]): Promise<HistoryRow[]> {
    const rows = await this.database.executeQuery<any>(query, params);
    return rows.map((row: any) => ({
      id: Number(row.id),
      conversation_id: row.conversation_id ?? null,
      message_id: row.message_id ?? null,
      group_id: row.group_id ?? undefined,
      user_id: row.user_id ?? undefined,
      sender_id: row.sender_id,
      sender_role: row.sender_role,
      content: row.content,
      content_type: row.content_type,
      sent_at: row.sent_at,
      raw_payload: this.parseRawPayload(row.raw_payload)
    }));
  }

  private toContextHistoryMessage(row: HistoryRow): ContextHistoryMessage {
    return {
      history_id: row.id,
      conversation_id: row.conversation_id ?? null,
      message_id: row.message_id ?? null,
      group_id: row.group_id,
      user_id: row.user_id,
      sender_id: row.sender_id,
      sender_role: row.sender_role,
      content: row.content,
      content_type: row.content_type,
      sent_at: row.sent_at instanceof Date ? row.sent_at : new Date(row.sent_at),
      raw_payload: row.raw_payload
    };
  }

  private async getAttendedHistoryIds(
    historyTable: ChatViewportHistoryTable,
    historyIds: number[]
  ): Promise<Set<number>> {
    if (historyIds.length === 0) {
      return new Set<number>();
    }

    const placeholders = historyIds.map(() => '?').join(', ');
    const rows = await this.database.executeQuery<{ message_history_id: number }>(
      `
        SELECT DISTINCT message_history_id
        FROM message_attention_events
        WHERE message_history_table = ?
          AND message_history_id IN (${placeholders})
          AND attention_state IN ('attended', 'acted', 'referenced')
      `,
      [historyTable, ...historyIds]
    );

    return new Set(rows.map(row => Number(row.message_history_id)));
  }

  private async countUnreadMessages(
    historyTable: ChatViewportHistoryTable,
    sourceType: ChatViewportSourceType,
    sourceId: number
  ): Promise<number> {
    const sourceColumn = sourceType === 'group' ? 'group_id' : 'user_id';
    const rows = await this.database.executeQuery<{ unread_count: number }>(
      `
        SELECT COUNT(*) AS unread_count
        FROM ${historyTable} h
        WHERE h.${sourceColumn} = ?
          AND NOT EXISTS (
            SELECT 1
            FROM message_attention_events e
            WHERE e.message_history_table = ?
              AND e.message_history_id = h.id
              AND e.attention_state IN ('attended', 'acted', 'referenced')
          )
      `,
      [sourceId, historyTable]
    );

    return Number(rows[0]?.unread_count ?? 0);
  }

  private async recordAttentionEvents(params: {
    historyTable: ChatViewportHistoryTable;
    sourceKey: string;
    sourceType: ChatViewportSourceType;
    sourceId: number;
    historyIds: number[];
  }): Promise<void> {
    const { historyTable, sourceKey, sourceType, sourceId, historyIds } = params;

    for (const historyId of historyIds) {
      await this.database.executeUpdate(
        `
          INSERT IGNORE INTO message_attention_events (
            source_key,
            source_type,
            source_id,
            message_history_table,
            message_history_id,
            attention_state,
            attention_reason
          ) VALUES (?, ?, ?, ?, ?, 'attended', 'viewport_visible')
        `,
        [sourceKey, sourceType, sourceId, historyTable, historyId]
      );
    }
  }

  private async ensureAttentionTable(): Promise<void> {
    if (this.attentionTableEnsured) {
      return;
    }

    try {
      await this.database.executeUpdate(
        `
          CREATE TABLE IF NOT EXISTS message_attention_events (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            source_key VARCHAR(100) NOT NULL,
            source_type ENUM('private', 'group') NOT NULL,
            source_id BIGINT NOT NULL,
            message_history_table ENUM('private_message_history', 'group_message_history') NOT NULL,
            message_history_id BIGINT UNSIGNED NOT NULL,
            attention_state ENUM('attended', 'referenced', 'acted') NOT NULL DEFAULT 'attended',
            attention_reason VARCHAR(50) NOT NULL DEFAULT 'viewport_visible',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_attention_state (
              source_key,
              message_history_table,
              message_history_id,
              attention_state
            ),
            INDEX idx_attention_lookup (message_history_table, message_history_id),
            INDEX idx_attention_source (source_key, created_at)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `
      );
      this.attentionTableEnsured = true;
    } catch (error) {
      this.moduleLogger.error('Failed to ensure message_attention_events table', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private normalizePageSize(pageSize: number): number {
    const normalized = Math.floor(Number(pageSize));
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return DEFAULT_VIEWPORT_SIZE;
    }

    return Math.min(20, normalized);
  }

  private parseRawPayload(rawPayload: any): any {
    if (typeof rawPayload !== 'string') {
      return rawPayload;
    }

    try {
      return JSON.parse(rawPayload);
    } catch (error) {
      return rawPayload;
    }
  }

  private resolveSourceDescriptor(
    messageType: 'private' | 'group',
    userId: number,
    groupId?: number
  ): {
    historyTable: ChatViewportHistoryTable;
    sourceType: ChatViewportSourceType;
    sourceId: number;
  } | null {
    if (messageType === 'group' && groupId) {
      return {
        historyTable: 'group_message_history',
        sourceType: 'group',
        sourceId: groupId
      };
    }

    if (messageType === 'private') {
      return {
        historyTable: 'private_message_history',
        sourceType: 'private',
        sourceId: userId
      };
    }

    return null;
  }
}

const normalizedPrivateHeader = (userId: number): string =>
  `当前窗口：与 QQ ${userId} 的私聊`;

const normalizedGroupHeader = (groupId: number): string =>
  `当前窗口：群聊 ${groupId}`;
