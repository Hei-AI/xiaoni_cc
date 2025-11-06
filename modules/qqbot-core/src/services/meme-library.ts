import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { MemeLibraryEntry } from '../tools/static-tools';

interface MemeLibraryOptions {
  storagePath?: string;
}

interface StoredMemeEntry extends MemeLibraryEntry {
  usage_count: number;
}

const DEFAULT_STORAGE_PATH = path.resolve(process.cwd(), 'resources', 'memes', 'library.json');

/**
 * 简易表情包素材库：以 JSON 文件形式存储/检索。
 * 该实现偏向轻量使用场景，后续如需迁移至数据库，可保持同样的接口。
 */
export class MemeLibrary {
  private filePath: string;
  private loaded: boolean = false;
  private entries: StoredMemeEntry[] = [];
  private moduleLogger = logger.createModuleLogger('meme-library');

  constructor(options?: MemeLibraryOptions) {
    this.filePath = options?.storagePath ?? DEFAULT_STORAGE_PATH;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });

      try {
        const raw = await fs.readFile(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);

        if (Array.isArray(parsed)) {
          this.entries = parsed
            .filter(item => typeof item === 'object' && item !== null)
            .map(item => this.normalizeEntry(item as Partial<StoredMemeEntry>));
        } else {
          this.moduleLogger.warn('Meme library file is not an array, resetting to empty list', {
            file: this.filePath
          });
          this.entries = [];
        }
      } catch (error: any) {
        if (error?.code === 'ENOENT') {
          this.entries = [];
          await this.persist();
        } else {
          throw error;
        }
      }

      this.loaded = true;
    } catch (error) {
      this.moduleLogger.error('Failed to initialize meme library', {
        error: error instanceof Error ? error.message : String(error),
        file: this.filePath
      });
      throw error;
    }
  }

  private normalizeEntry(entry: Partial<StoredMemeEntry>): StoredMemeEntry {
    const id = typeof entry.id === 'string' && entry.id.trim().length > 0 ? entry.id : uuidv4();
    const tags = Array.isArray(entry.tags)
      ? entry.tags.filter(tag => typeof tag === 'string' && tag.trim().length > 0).map(tag => tag.trim())
      : [];
    const imageBase64 =
      typeof entry.image_base64 === 'string' && entry.image_base64.trim().length > 0
        ? entry.image_base64.replace(/\s+/g, '')
        : '';

    const createdAt =
      typeof entry.created_at === 'string' && !Number.isNaN(Date.parse(entry.created_at))
        ? entry.created_at
        : new Date().toISOString();

    const updatedAt =
      typeof entry.updated_at === 'string' && !Number.isNaN(Date.parse(entry.updated_at))
        ? entry.updated_at
        : createdAt;

    const usageCount =
      typeof entry.usage_count === 'number' && Number.isFinite(entry.usage_count) && entry.usage_count >= 0
        ? Math.floor(entry.usage_count)
        : 0;

    if (tags.length === 0 || imageBase64.length === 0) {
      throw new Error('Invalid meme entry encountered while normalizing');
    }

    return {
      id,
      tags,
      image_base64: imageBase64,
      created_at: createdAt,
      updated_at: updatedAt,
      usage_count: usageCount
    };
  }

  private async persist(): Promise<void> {
    const payload = JSON.stringify(this.entries, null, 2);
    await fs.writeFile(this.filePath, payload, 'utf-8');
  }

  private buildScore(targetTags: string[], candidate: StoredMemeEntry): number {
    const candidateTagSet = new Set(candidate.tags);
    const targetTagSet = new Set(targetTags);

    let intersection = 0;
    for (const tag of targetTagSet) {
      if (candidateTagSet.has(tag)) {
        intersection += 1;
      }
    }

    if (intersection === 0) {
      return -1;
    }

    const coverage = intersection / candidate.tags.length;
    const requestCoverage = intersection / targetTags.length;

    // 主要按交集数量排序，其次考虑覆盖率，最后考虑最近更新时间
    const recencyBonus = candidate.updated_at ? Date.parse(candidate.updated_at) / 1_000_000_000 : 0;
    return intersection * 100 + coverage * 10 + requestCoverage + recencyBonus;
  }

  async addMeme(imageBase64: string, tags: string[]): Promise<MemeLibraryEntry> {
    await this.ensureLoaded();

    const now = new Date().toISOString();
    const entry: StoredMemeEntry = {
      id: uuidv4(),
      tags: Array.from(new Set(tags.map(tag => tag.trim()))),
      image_base64: imageBase64.replace(/\s+/g, ''),
      created_at: now,
      updated_at: now,
      usage_count: 0
    };

    this.entries.push(entry);
    await this.persist();

    return {
      id: entry.id,
      tags: entry.tags,
      image_base64: entry.image_base64,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
      usage_count: entry.usage_count
    };
  }

  async findBestMatch(tags: string[]): Promise<MemeLibraryEntry | null> {
    await this.ensureLoaded();

    if (this.entries.length === 0) {
      return null;
    }

    const normalizedTags = Array.from(new Set(tags.map(tag => tag.trim())));

    let bestScore = -1;
    let bestEntry: StoredMemeEntry | null = null;

    for (const entry of this.entries) {
      const score = this.buildScore(normalizedTags, entry);
      if (score > bestScore) {
        bestScore = score;
        bestEntry = entry;
      }
    }

    if (!bestEntry || bestScore < 0) {
      return null;
    }

    return {
      id: bestEntry.id,
      tags: bestEntry.tags,
      image_base64: bestEntry.image_base64,
      created_at: bestEntry.created_at,
      updated_at: bestEntry.updated_at,
      usage_count: bestEntry.usage_count
    };
  }

  async recordUsage(memeId: string): Promise<void> {
    await this.ensureLoaded();

    const target = this.entries.find(entry => entry.id === memeId);
    if (!target) {
      return;
    }

    target.usage_count += 1;
    target.updated_at = new Date().toISOString();

    await this.persist();
  }
}

export default MemeLibrary;
