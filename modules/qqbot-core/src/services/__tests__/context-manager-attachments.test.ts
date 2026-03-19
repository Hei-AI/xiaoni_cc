import { ContextManager } from '../context-manager';
import { DatabaseManager } from '../database';
import { OB11Segment } from '../../types';

describe('ContextManager attachment handling', () => {
  const createManager = () => new ContextManager({} as unknown as DatabaseManager);

  it('collects GIF attachments from message segments before provider-specific conversion', () => {
    const manager = createManager();

    const segments: OB11Segment[] = [
      {
        type: 'image',
        data: {
          file: 'sticker.gif',
          base64: 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
          mime: 'image/gif'
        }
      } as OB11Segment,
      {
        type: 'image',
        data: {
          file: 'photo.png',
          base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ',
          mime: 'image/png'
        }
      } as OB11Segment
    ];

    const attachments = (manager as any).collectImageAttachmentsFromMessageComponents(
      segments,
      undefined,
      undefined
    );

    expect(attachments).toHaveLength(2);
    expect(attachments[0].mimeType).toBe('image/gif');
    expect(attachments[1].mimeType).toBe('image/png');
  });

  it('collects GIF attachments from local attachment entries before provider-specific conversion', () => {
    const manager = createManager();

    const attachments = (manager as any).buildPromptAttachmentsFromLocalEntries([
      {
        type: 'image',
        mimeType: 'image/gif',
        base64: 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
        originalName: 'expression.gif'
      },
      {
        type: 'image',
        mimeType: 'image/jpeg',
        base64: '/9j/4AAQSkZJRgABAQAAAQABAAD',
        originalName: 'photo.jpg'
      }
    ]);

    expect(attachments).toHaveLength(2);
    expect(attachments[0].mimeType).toBe('image/gif');
    expect(attachments[1].mimeType).toBe('image/jpeg');
  });

  it('converts GIF attachments to WebP before Gemini submission', async () => {
    const manager = createManager();

    const prepared = await (manager as any).prepareAttachmentForGemini({
      type: 'image',
      mimeType: 'image/gif',
      data: 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
    });

    expect(prepared).toEqual({
      type: 'image',
      mimeType: 'image/webp',
      data: Buffer.from('mock-webp').toString('base64')
    });
  });
});
