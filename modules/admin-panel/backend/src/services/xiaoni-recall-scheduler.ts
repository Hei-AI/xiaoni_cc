import { reindexXiaoniRecall } from './xiaoni-recall-reindex-service';
import { logger } from '../utils/logger';

// 被动召回自动重扫节律。之前 reindexXiaoniRecall 只有手动 POST 触发(管理端「重建」按钮),
// 没人点就不跑 —— 三条腿(文件语料 / open_loop / 纯往事)都只在人肉点按钮那一刻产生一次
// shadow,连观察都不连续,「按时间盯着」更无从谈起。这里加一个定时器让它按节律自己跑。
//
// 仍是 shadow-only:重扫只写语料 + shadow_log,不投递给小腻(投递是 v2 另一步)。
// 单飞:一轮没跑完不叠下一轮。永不抛出拖垮进程。

const TRUE_SET = new Set(['1', 'true', 'yes', 'on']);
const FALSE_SET = new Set(['0', 'false', 'no', 'off']);

function envFlag(name: string, defaultOn: boolean): boolean {
  const raw = (process.env[name] || '').trim().toLowerCase();
  if (TRUE_SET.has(raw)) return true;
  if (FALSE_SET.has(raw)) return false;
  return defaultOn;
}

function envInt(name: string, fallback: number, min: number): number {
  const raw = Number.parseInt(String(process.env[name] || ''), 10);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, raw);
}

let running = false;

async function runOnce(reason: string): Promise<void> {
  if (running) {
    logger.info(`[recall-scheduler] 上一轮还在跑,跳过本次(${reason})`);
    return;
  }
  running = true;
  const startedAt = Date.now();
  try {
    const result = await reindexXiaoniRecall({});
    const openLoop = result.openLoopScan;
    const diary = result.diaryResurfaceScan;
    const association = result.associationScan;
    logger.info('[recall-scheduler] 重扫完成', {
      reason,
      durationMs: Date.now() - startedAt,
      changed: result.changed,
      upserted: result.upserted,
      totalCues: result.counts?.total,
      openLoopSurfaced: openLoop ? openLoop.surfaced.length : null,
      openLoopTotalOpen: openLoop ? openLoop.totalOpen : null,
      diarySurfaced: diary ? diary.surfaced.length : null,
      diaryTotalEvents: diary ? diary.totalEvents : null,
      // 第四腿(联想):浮了几条 + 四个桶各有多少候选(空桶就少浮,靠这个读出来)
      associationSurfaced: association ? association.surfaced.length : null,
      associationCandidates: association ? association.candidates : null,
      associationBuckets: association?.stats ? association.stats.byBucket : null
    });
  } catch (error) {
    // 绝不让重扫失败拖垮 admin-backend 进程。
    logger.error('[recall-scheduler] 重扫失败(已吞,不影响服务)', {
      reason,
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    running = false;
  }
}

// 启动被动召回自动重扫。默认开;可用 XIAONI_RECALL_AUTO_REINDEX=0 关。
export function startPassiveRecallScheduler(): void {
  if (!envFlag('XIAONI_RECALL_AUTO_REINDEX', true)) {
    logger.info('[recall-scheduler] 自动重扫已关闭(XIAONI_RECALL_AUTO_REINDEX=0)');
    return;
  }
  const intervalMs = envInt('XIAONI_RECALL_REINDEX_INTERVAL_MS', 30 * 60 * 1000, 60 * 1000);
  const initialDelayMs = envInt('XIAONI_RECALL_REINDEX_INITIAL_DELAY_MS', 60 * 1000, 0);
  logger.info('[recall-scheduler] 自动重扫已启用', { intervalMs, initialDelayMs });

  // 首扫延迟一会儿,等 provider-service(嵌入)起来再跑。
  const kickoff = setTimeout(() => {
    void runOnce('startup');
    const timer = setInterval(() => {
      void runOnce('interval');
    }, intervalMs);
    // 定时器不该拖住进程退出。
    if (typeof timer.unref === 'function') timer.unref();
  }, initialDelayMs);
  if (typeof kickoff.unref === 'function') kickoff.unref();
}
