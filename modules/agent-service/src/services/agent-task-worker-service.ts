import {
  addAgentTaskArtifacts,
  claimNextAgentTask,
  listAgentMediaAssets,
  updateAgentTask,
} from '@qq-bot/persistence';
import { agentConfig, databaseConfig } from '../config';
import { logger } from '../utils/logger';

const moduleLogger = logger.createModuleLogger('agent-task-worker-service');

type AgentTaskRecord = {
  id: string;
  task_type: string;
  session_key: string;
  chat_type: string;
  peer_id?: string | null;
  prompt: string;
  target_description?: string | null;
  source_media_asset_ids?: string[];
  input_json?: Record<string, unknown>;
};

type AgentMediaAssetRecord = {
  id: string;
  media_tag?: string;
  media_type?: string;
  mime_type?: string | null;
  source_locator?: string | null;
  storage_uri?: string | null;
  placeholder?: string | null;
  metadata?: Record<string, unknown> | null;
};

type ImageProviderImage = {
  data_url?: string;
  url?: string;
  mime_type?: string;
  format?: string;
  revised_prompt?: string;
  bytes_estimate?: number;
};

type ImageProviderPayload = {
  success?: boolean;
  error?: string;
  data?: {
    images?: ImageProviderImage[];
    model?: string;
    usage?: unknown;
  };
};

function firstNonEmptyString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeImageArtifacts(taskId: string, images: ImageProviderImage[]) {
  return images.map((image, index) => ({
    id: `task_artifact_${Date.now()}_${index}`,
    taskId,
    kind: 'image',
    dataUrl: firstNonEmptyString(image.data_url),
    publicPath: firstNonEmptyString(image.url),
    mimeType: firstNonEmptyString(image.mime_type) || 'image/png',
    format: firstNonEmptyString(image.format),
    bytes: image.bytes_estimate,
    revisedPrompt: firstNonEmptyString(image.revised_prompt),
    metadata: {
      provider_index: index
    }
  }));
}

export class AgentTaskWorkerService {
  async processNext(workerId: string) {
    const task = await claimNextAgentTask(workerId, databaseConfig) as AgentTaskRecord | null;
    if (!task) {
      return false;
    }

    try {
      await this.processTask(task);
      return true;
    } catch (error) {
      moduleLogger.error('Agent task failed', {
        taskId: task.id,
        taskType: task.task_type,
        error: error instanceof Error ? error.message : String(error)
      });
      await updateAgentTask({
        id: task.id,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error)
      }, databaseConfig).catch(() => undefined);
      return true;
    }
  }

  private async processTask(task: AgentTaskRecord) {
    if (task.task_type !== 'image_generate' && task.task_type !== 'image_edit') {
      throw new Error(`Unsupported agent task type: ${task.task_type}`);
    }

    const providerPayload = await this.callImageProvider(task);
    const images = Array.isArray(providerPayload.data?.images) ? providerPayload.data.images : [];
    if (images.length === 0) {
      throw new Error('Image provider returned no images');
    }

    const artifacts = await addAgentTaskArtifacts(
      task.id,
      normalizeImageArtifacts(task.id, images),
      databaseConfig
    );
    await updateAgentTask({
      id: task.id,
      status: 'completed',
      resultJson: {
        model: providerPayload.data?.model || null,
        image_count: images.length,
        usage: providerPayload.data?.usage || null
      }
    }, databaseConfig);

    if (task.chat_type === 'group') {
      await this.deliverFirstImage(task, artifacts[0] || {});
    }
  }

  private async callImageProvider(task: AgentTaskRecord): Promise<ImageProviderPayload> {
    const body: Record<string, unknown> = {
      prompt: task.prompt,
      n: 1
    };

    let endpoint = '/api/internal/image/generate';
    if (task.task_type === 'image_edit') {
      const sourceImages = await this.resolveSourceImageInputs(task);
      if (sourceImages.length === 0) {
        throw new Error('Image edit task requires at least one readable source image');
      }
      body.images = sourceImages;
      endpoint = '/api/internal/image/edit';
    }

    const response = await fetch(`${agentConfig.providerServiceUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const payload = await response.json() as ImageProviderPayload;
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || `Image provider failed with ${response.status}`);
    }
    return payload;
  }

  private async resolveSourceImageInputs(task: AgentTaskRecord) {
    const ids = new Set(Array.isArray(task.source_media_asset_ids) ? task.source_media_asset_ids : []);
    if (ids.size === 0) {
      return [];
    }
    const assets = await listAgentMediaAssets({
      sessionKey: task.session_key,
      limit: 100
    }, databaseConfig);
    const sourceAssets = assets
      .filter((asset: any) => ids.has(asset.id))
      .filter((asset: AgentMediaAssetRecord) => this.isImageLikeAsset(asset));
    const images = [];
    for (const asset of sourceAssets) {
      const image = await this.materializeSourceImage(asset);
      if (image) {
        images.push(image);
      }
    }
    return images;
  }

  private isImageLikeAsset(asset: AgentMediaAssetRecord) {
    const mimeType = firstNonEmptyString(asset.mime_type)?.toLowerCase();
    const locator = firstNonEmptyString(asset.storage_uri, asset.source_locator)?.toLowerCase() || '';
    const fileName = typeof asset.metadata?.file_name === 'string'
      ? asset.metadata.file_name.toLowerCase()
      : '';
    return asset.media_type === 'image'
      || Boolean(mimeType?.startsWith('image/'))
      || /\.(png|jpe?g|webp|gif)(?:$|[?#])/i.test(locator)
      || /\.(png|jpe?g|webp|gif)$/i.test(fileName);
  }

  private async materializeSourceImage(asset: AgentMediaAssetRecord) {
    const sourceLocator = firstNonEmptyString(asset.storage_uri, asset.source_locator);
    const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/media/materialize-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source_locator: sourceLocator,
        mime_type: firstNonEmptyString(asset.mime_type),
        metadata: asset.metadata || {}
      })
    });
    const payload = await response.json() as {
      success?: boolean;
      error?: string;
      data?: {
        data_url?: string;
        mime_type?: string;
        filename?: string;
      };
    };
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || `Source image materialize failed with ${response.status}`);
    }
    const dataUrl = firstNonEmptyString(payload.data?.data_url);
    if (!dataUrl) {
      throw new Error('Source image materialize returned no image data');
    }
    return {
      data_url: dataUrl,
      mime_type: firstNonEmptyString(payload.data?.mime_type) || firstNonEmptyString(asset.mime_type) || 'image/png',
      filename: firstNonEmptyString(payload.data?.filename, asset.metadata?.file_name) || `${asset.media_tag || asset.id}.png`
    };
  }

  private async deliverFirstImage(task: AgentTaskRecord, artifact: Record<string, unknown>) {
    const groupId = Number(task.peer_id);
    const imageFile = firstNonEmptyString(artifact.data_url, artifact.public_path, artifact.file_path);
    if (!Number.isFinite(groupId) || !imageFile) {
      return;
    }

    const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/send_group_image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session_key: task.session_key,
        group_id: groupId,
        image_file: imageFile
      })
    });
    const payload = await response.json() as { success?: boolean; error?: string };
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || `Group image delivery failed with ${response.status}`);
    }
  }
}
