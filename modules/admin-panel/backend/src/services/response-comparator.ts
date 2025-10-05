/**
 * 响应对比服务
 * 对比原始响应和重放响应，生成差异报告
 */

import * as diff from 'deep-diff';

// ==================== 类型定义 ====================

interface ComparisonResult {
  statusMatch: boolean;
  statusOriginal: number;
  statusReplayed: number;

  bodyMatch: boolean;
  bodyDiff: DiffNode[];
  bodyOriginal: any;
  bodyReplayed: any;
  bodySizeDiff: number;

  headersDiff: HeaderDiff[];

  durationOriginal: number;
  durationReplayed: number;
  durationDiff: number;
  durationDiffPercent: number;

  overallSimilarity: number;   // 0-100，相似度评分
}

interface DiffNode {
  kind: 'N' | 'D' | 'E' | 'A';  // New/Deleted/Edited/Array
  path: string[];
  lhs?: any;                     // 左侧值 (原始)
  rhs?: any;                     // 右侧值 (重放)
  index?: number;
  item?: any;
}

interface HeaderDiff {
  key: string;
  type: 'added' | 'removed' | 'changed';
  original?: string;
  replayed?: string;
}

interface TrafficLog {
  id: number;
  response_status?: number;
  response_headers?: any;
  response_body?: string;
  response_size?: number;
  duration_ms?: number;
}

interface ReplayResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  duration: number;
  size?: number;
}

// ==================== ResponseComparator类 ====================

export class ResponseComparator {

  /**
   * 对比两个响应
   */
  compare(
    original: TrafficLog,
    replayed: ReplayResponse
  ): ComparisonResult {
    // 状态码对比
    const statusOriginal = original.response_status || 0;
    const statusReplayed = replayed.status;
    const statusMatch = statusOriginal === statusReplayed;

    // 响应体对比
    const bodyComparison = this.compareBody(
      original.response_body || '',
      replayed.body
    );

    // 响应头对比
    const originalHeaders = this.parseHeaders(original.response_headers);
    const headersDiff = this.compareHeaders(originalHeaders, replayed.headers);

    // 性能指标对比
    const durationOriginal = original.duration_ms || 0;
    const durationReplayed = replayed.duration;
    const durationDiff = durationReplayed - durationOriginal;
    const durationDiffPercent = durationOriginal > 0
      ? (durationDiff / durationOriginal) * 100
      : 0;

    // 响应大小对比
    const bodySizeDiff = (replayed.size || replayed.body.length) - (original.response_size || 0);

    // 计算相似度评分
    const overallSimilarity = this.calculateSimilarity({
      statusMatch,
      bodyMatch: bodyComparison.match,
      bodyDiff: bodyComparison.diff,
      headersDiff,
      durationDiffPercent
    });

    return {
      statusMatch,
      statusOriginal,
      statusReplayed,
      bodyMatch: bodyComparison.match,
      bodyDiff: bodyComparison.diff,
      bodyOriginal: bodyComparison.original,
      bodyReplayed: bodyComparison.replayed,
      bodySizeDiff,
      headersDiff,
      durationOriginal,
      durationReplayed,
      durationDiff,
      durationDiffPercent,
      overallSimilarity
    };
  }

  /**
   * 对比响应体
   */
  private compareBody(originalBody: string, replayedBody: string): {
    match: boolean;
    diff: DiffNode[];
    original: any;
    replayed: any;
  } {
    // 尝试解析为JSON
    let originalParsed: any;
    let replayedParsed: any;
    let isJson = false;

    try {
      originalParsed = JSON.parse(originalBody);
      replayedParsed = JSON.parse(replayedBody);
      isJson = true;
    } catch {
      // 不是JSON，作为文本比较
      originalParsed = originalBody;
      replayedParsed = replayedBody;
    }

    // 如果完全相同，快速返回
    if (originalBody === replayedBody) {
      return {
        match: true,
        diff: [],
        original: originalParsed,
        replayed: replayedParsed
      };
    }

    // 使用deep-diff库计算差异
    let differences: any[] = [];
    if (isJson) {
      const rawDiff = diff.diff(originalParsed, replayedParsed);
      differences = rawDiff ? this.convertDeepDiff(rawDiff) : [];
    } else {
      // 文本差异
      if (originalBody !== replayedBody) {
        differences = [{
          kind: 'E' as const,
          path: ['text'],
          lhs: originalBody,
          rhs: replayedBody
        }];
      }
    }

    return {
      match: differences.length === 0,
      diff: differences,
      original: originalParsed,
      replayed: replayedParsed
    };
  }

  /**
   * 对比响应头
   */
  private compareHeaders(
    original: Record<string, string>,
    replayed: Record<string, string>
  ): HeaderDiff[] {
    const diffs: HeaderDiff[] = [];

    // 检查原始响应头中的每个键
    for (const [key, value] of Object.entries(original)) {
      if (!(key in replayed)) {
        diffs.push({
          key,
          type: 'removed',
          original: value
        });
      } else if (original[key] !== replayed[key]) {
        diffs.push({
          key,
          type: 'changed',
          original: value,
          replayed: replayed[key]
        });
      }
    }

    // 检查重放响应头中新增的键
    for (const [key, value] of Object.entries(replayed)) {
      if (!(key in original)) {
        diffs.push({
          key,
          type: 'added',
          replayed: value
        });
      }
    }

    return diffs;
  }

  /**
   * 转换deep-diff结果为统一格式
   */
  private convertDeepDiff(rawDiff: diff.Diff<any, any>[]): DiffNode[] {
    return rawDiff.map(d => {
      const node: DiffNode = {
        kind: d.kind,
        path: d.path || []
      };

      // Type guard for different diff kinds
      if (d.kind === 'N') {
        // New value - only has rhs
        node.rhs = (d as diff.DiffNew<any>).rhs;
      } else if (d.kind === 'D') {
        // Deleted value - only has lhs
        node.lhs = (d as diff.DiffDeleted<any>).lhs;
      } else if (d.kind === 'E') {
        // Edited value - has both lhs and rhs
        node.lhs = (d as diff.DiffEdit<any, any>).lhs;
        node.rhs = (d as diff.DiffEdit<any, any>).rhs;
      } else if (d.kind === 'A') {
        // Array diff
        node.index = (d as diff.DiffArray<any, any>).index;
        node.item = (d as diff.DiffArray<any, any>).item;
      }

      return node;
    });
  }

  /**
   * 计算相似度评分 (0-100)
   */
  calculateSimilarity(params: {
    statusMatch: boolean;
    bodyMatch: boolean;
    bodyDiff: DiffNode[];
    headersDiff: HeaderDiff[];
    durationDiffPercent: number;
  }): number {
    let score = 0;

    // 状态码匹配 (30分)
    if (params.statusMatch) {
      score += 30;
    }

    // 响应体匹配 (50分)
    if (params.bodyMatch) {
      score += 50;
    } else {
      // 根据差异数量扣分
      const diffCount = params.bodyDiff.length;
      const penalty = Math.min(diffCount * 5, 50);
      score += Math.max(50 - penalty, 0);
    }

    // 响应头匹配 (10分)
    const headerDiffCount = params.headersDiff.length;
    if (headerDiffCount === 0) {
      score += 10;
    } else {
      const penalty = Math.min(headerDiffCount * 2, 10);
      score += Math.max(10 - penalty, 0);
    }

    // 性能差异 (10分)
    const durationDiffAbs = Math.abs(params.durationDiffPercent);
    if (durationDiffAbs < 10) {
      score += 10;
    } else if (durationDiffAbs < 50) {
      score += 5;
    }

    return Math.round(score);
  }

  /**
   * 格式化差异为人类可读文本
   */
  formatDiffReport(comparison: ComparisonResult): string {
    const lines: string[] = [];

    lines.push('=== 响应对比报告 ===\n');

    // 状态码
    lines.push(`状态码: ${comparison.statusOriginal} → ${comparison.statusReplayed}`);
    lines.push(`  ${comparison.statusMatch ? '✓ 匹配' : '✗ 不匹配'}\n`);

    // 响应时间
    lines.push(`响应时间: ${comparison.durationOriginal}ms → ${comparison.durationReplayed}ms`);
    lines.push(`  差异: ${comparison.durationDiff > 0 ? '+' : ''}${comparison.durationDiff}ms (${comparison.durationDiffPercent.toFixed(1)}%)\n`);

    // 响应大小
    lines.push(`响应大小差异: ${comparison.bodySizeDiff > 0 ? '+' : ''}${comparison.bodySizeDiff} bytes\n`);

    // 响应体差异
    if (comparison.bodyMatch) {
      lines.push('响应体: ✓ 完全匹配\n');
    } else {
      lines.push(`响应体: ✗ 发现 ${comparison.bodyDiff.length} 处差异`);

      for (const d of comparison.bodyDiff.slice(0, 10)) {
        const pathStr = d.path.join('.');
        if (d.kind === 'N') {
          lines.push(`  + 新增: ${pathStr} = ${JSON.stringify(d.rhs)}`);
        } else if (d.kind === 'D') {
          lines.push(`  - 删除: ${pathStr} = ${JSON.stringify(d.lhs)}`);
        } else if (d.kind === 'E') {
          lines.push(`  ≠ 修改: ${pathStr}`);
          lines.push(`      原始: ${JSON.stringify(d.lhs)}`);
          lines.push(`      重放: ${JSON.stringify(d.rhs)}`);
        }
      }

      if (comparison.bodyDiff.length > 10) {
        lines.push(`  ... (还有 ${comparison.bodyDiff.length - 10} 处差异)`);
      }
      lines.push('');
    }

    // 响应头差异
    if (comparison.headersDiff.length === 0) {
      lines.push('响应头: ✓ 完全匹配\n');
    } else {
      lines.push(`响应头: 发现 ${comparison.headersDiff.length} 处差异`);

      for (const d of comparison.headersDiff) {
        if (d.type === 'added') {
          lines.push(`  + ${d.key}: ${d.replayed}`);
        } else if (d.type === 'removed') {
          lines.push(`  - ${d.key}: ${d.original}`);
        } else if (d.type === 'changed') {
          lines.push(`  ≠ ${d.key}: ${d.original} → ${d.replayed}`);
        }
      }
      lines.push('');
    }

    // 相似度
    lines.push(`整体相似度: ${comparison.overallSimilarity}%`);

    return lines.join('\n');
  }

  /**
   * 解析响应头（支持多种格式）
   */
  private parseHeaders(headers: any): Record<string, string> {
    if (!headers) {
      return {};
    }

    // 如果已经是对象，直接返回
    if (typeof headers === 'object' && !Array.isArray(headers)) {
      return headers;
    }

    // 如果是字符串，尝试解析JSON
    if (typeof headers === 'string') {
      try {
        return JSON.parse(headers);
      } catch {
        return {};
      }
    }

    return {};
  }

  /**
   * 生成差异摘要（用于数据库存储）
   */
  generateDiffSummary(comparison: ComparisonResult): any {
    return {
      statusMatch: comparison.statusMatch,
      bodyMatch: comparison.bodyMatch,
      bodyDiffCount: comparison.bodyDiff.length,
      headersDiffCount: comparison.headersDiff.length,
      durationDiff: comparison.durationDiff,
      durationDiffPercent: comparison.durationDiffPercent,
      bodySizeDiff: comparison.bodySizeDiff,
      similarity: comparison.overallSimilarity,
      topDifferences: comparison.bodyDiff.slice(0, 5).map(d => ({
        kind: d.kind,
        path: d.path.join('.'),
        lhs: this.truncateValue(d.lhs),
        rhs: this.truncateValue(d.rhs)
      }))
    };
  }

  /**
   * 截断过长的值（用于摘要）
   */
  private truncateValue(value: any, maxLength: number = 100): any {
    if (value === null || value === undefined) {
      return value;
    }

    const str = typeof value === 'string' ? value : JSON.stringify(value);
    if (str.length > maxLength) {
      return str.substring(0, maxLength) + '...';
    }
    return value;
  }
}

// ==================== 导出单例 ====================

export const responseComparator = new ResponseComparator();
