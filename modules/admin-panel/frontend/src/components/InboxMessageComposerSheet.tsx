import React, { useEffect, useMemo, useState } from 'react';
import { MessageSquareQuote, Send, UserRound } from 'lucide-react';
import { StructuredDataViewer } from '@/components/StructuredDataViewer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export interface InboxConversationContext {
  sessionKey: string;
  chatType: 'direct' | 'group';
  peerId: string;
  peerName?: string;
  accountId: string;
  latestSenderId?: string;
  latestSenderName?: string;
}

export interface InboxSimulationPayload {
  inboundContext: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
}

interface InboxMessageComposerDraft {
  body: string;
  senderId: string;
  senderName: string;
  wasMentioned: boolean;
  includeReply: boolean;
  replyToId: string;
  replyToBody: string;
  replyToSender: string;
}

interface InboxMessageComposerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedConversation?: InboxConversationContext | null;
  onMessageSent?: (conversation: InboxConversationContext) => Promise<void> | void;
}

function buildConversationLabel(selectedConversation: InboxConversationContext) {
  return selectedConversation.peerName
    || (selectedConversation.chatType === 'group'
      ? `群 ${selectedConversation.peerId}`
      : `QQ ${selectedConversation.peerId}`);
}

function defaultSenderId(selectedConversation: InboxConversationContext) {
  if (selectedConversation.latestSenderId) {
    return selectedConversation.latestSenderId;
  }

  return selectedConversation.chatType === 'group'
    ? '85178516'
    : selectedConversation.peerId;
}

function createDraft(selectedConversation: InboxConversationContext): InboxMessageComposerDraft {
  const conversationLabel = buildConversationLabel(selectedConversation);
  const senderId = defaultSenderId(selectedConversation);

  return {
    body: selectedConversation.chatType === 'group'
      ? `@小腻 运维模拟投递到 ${conversationLabel}`
      : '运维模拟投递',
    senderId,
    senderName: selectedConversation.latestSenderName || selectedConversation.peerName || senderId,
    wasMentioned: selectedConversation.chatType === 'group',
    includeReply: false,
    replyToId: '',
    replyToBody: '',
    replyToSender: '',
  };
}

export function buildInboxSimulationPayload(
  selectedConversation: InboxConversationContext,
  draft: InboxMessageComposerDraft,
): InboxSimulationPayload {
  const peerId = selectedConversation.peerId;
  const accountId = selectedConversation.accountId;
  const senderId = draft.senderId.trim() || defaultSenderId(selectedConversation);
  const senderName = draft.senderName.trim() || selectedConversation.latestSenderName || selectedConversation.peerName || senderId;
  const sessionKey = selectedConversation.sessionKey;
  const to = selectedConversation.chatType === 'group' ? `group:${peerId}` : `user:${peerId}`;
  const from = selectedConversation.chatType === 'group' ? `qq:group:${peerId}` : `qq:${senderId}`;
  const messageBody = draft.body.trim();

  return {
    inboundContext: {
      ChatType: selectedConversation.chatType,
      AccountId: accountId,
      SenderId: senderId,
      SenderName: senderName,
      SenderUsername: senderName,
      SessionKey: sessionKey,
      NativeChannelId: peerId,
      ConversationLabel: buildConversationLabel(selectedConversation),
      GroupSubject: selectedConversation.chatType === 'group'
        ? (selectedConversation.peerName || `群 ${peerId}`)
        : undefined,
      From: from,
      To: to,
      Body: messageBody,
      BodyForAgent: messageBody,
      RawBody: messageBody,
      CommandBody: messageBody,
      BodyForCommands: messageBody,
      Provider: 'qq',
      Surface: 'simulator',
      OriginatingChannel: 'qq',
      OriginatingTo: to,
      WasMentioned: draft.wasMentioned,
      ReplyToId: draft.includeReply && draft.replyToId.trim() ? draft.replyToId.trim() : undefined,
      ReplyToBody: draft.includeReply && draft.replyToBody.trim() ? draft.replyToBody.trim() : undefined,
      ReplyToSender: draft.includeReply && draft.replyToSender.trim() ? draft.replyToSender.trim() : undefined,
      ReplyToIsQuote: draft.includeReply ? true : undefined,
    },
    rawPayload: {
      simulated: true,
      source: 'admin-frontend',
      composer: 'structured',
      sessionKey,
      chatType: selectedConversation.chatType,
      peerId,
    },
  };
}

function FieldGroup({
  label,
  description,
  fieldId,
  children,
}: {
  label: string;
  description?: string;
  fieldId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label htmlFor={fieldId}>{label}</Label>
        {description ? <p className="text-xs leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

const InboxMessageComposerSheet: React.FC<InboxMessageComposerSheetProps> = ({
  open,
  onOpenChange,
  selectedConversation,
  onMessageSent,
}) => {
  const [draft, setDraft] = useState<InboxMessageComposerDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !selectedConversation) {
      return;
    }

    setDraft(createDraft(selectedConversation));
    setError(null);
  }, [open, selectedConversation]);

  const payloadPreview = useMemo(() => {
    if (!selectedConversation || !draft) {
      return null;
    }

    return buildInboxSimulationPayload(selectedConversation, draft);
  }, [draft, selectedConversation]);

  const submitMessage = async () => {
    if (!selectedConversation || !draft) {
      return;
    }

    if (!draft.body.trim()) {
      setError('请输入要投递的消息正文');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      const response = await fetch('/api/inbox/simulate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payloadPreview),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to post simulated message');
      }

      if (onMessageSent) {
        await onMessageSent(selectedConversation);
      }

      onOpenChange(false);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Failed to post simulated message');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-3xl border-l border-border bg-background px-0">
        <SheetHeader className="border-b border-border px-6 py-5 pr-12">
          <SheetTitle>POST 模拟消息</SheetTitle>
          <SheetDescription>
            用结构化表单生成内部通用消息体。这里预览最终 payload，但不允许手改 JSON。
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="space-y-6 px-6 py-6">
            {selectedConversation ? (
              <>
                <section className="rounded-2xl border border-border bg-muted/30 p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground">
                      {selectedConversation.chatType === 'group' ? '群聊' : '私聊'}
                    </span>
                    <span className="inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
                      Peer {selectedConversation.peerId}
                    </span>
                    <span className="inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
                      Account {selectedConversation.accountId}
                    </span>
                  </div>
                  <div className="grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">对象</div>
                      <div className="mt-1 font-medium text-foreground">{buildConversationLabel(selectedConversation)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">SessionKey</div>
                      <div className="mt-1 break-all font-mono text-xs text-foreground">{selectedConversation.sessionKey}</div>
                    </div>
                  </div>
                </section>

                {draft ? (
                  <div className="space-y-6">
                    <FieldGroup
                      label="消息正文"
                      description="提交时会自动映射到 Body、BodyForAgent、RawBody、CommandBody 和 BodyForCommands。"
                      fieldId="inbox-composer-body"
                    >
                      <Textarea
                        id="inbox-composer-body"
                        value={draft.body}
                        onChange={(event) => setDraft((current) => current ? { ...current, body: event.target.value } : current)}
                        className="min-h-[140px]"
                        placeholder="输入要投递的消息正文"
                      />
                    </FieldGroup>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <FieldGroup label="发送者 QQ" fieldId="inbox-composer-sender-id">
                        <Input
                          id="inbox-composer-sender-id"
                          value={draft.senderId}
                          onChange={(event) => setDraft((current) => current ? { ...current, senderId: event.target.value } : current)}
                          placeholder="发送者 QQ"
                        />
                      </FieldGroup>
                      <FieldGroup label="发送者昵称" fieldId="inbox-composer-sender-name">
                        <Input
                          id="inbox-composer-sender-name"
                          value={draft.senderName}
                          onChange={(event) => setDraft((current) => current ? { ...current, senderName: event.target.value } : current)}
                          placeholder="发送者昵称"
                        />
                      </FieldGroup>
                    </div>

                    <div className="rounded-2xl border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <UserRound className="h-4 w-4 text-primary" />
                            @bot / 提及标记
                          </div>
                          <p className="text-xs leading-5 text-muted-foreground">
                            群聊默认开启。关闭后，生成的消息体会把 `WasMentioned` 设为 `false`。
                          </p>
                        </div>
                        <Switch
                          checked={draft.wasMentioned}
                          onCheckedChange={(checked) => setDraft((current) => current ? { ...current, wasMentioned: checked } : current)}
                        />
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <MessageSquareQuote className="h-4 w-4 text-primary" />
                            引用消息
                          </div>
                          <p className="text-xs leading-5 text-muted-foreground">
                            需要模拟回复场景时再打开。关闭后不会发送任何 `ReplyTo*` 字段。
                          </p>
                        </div>
                        <Switch
                          checked={draft.includeReply}
                          onCheckedChange={(checked) => setDraft((current) => current ? { ...current, includeReply: checked } : current)}
                        />
                      </div>

                      <div className={cn('mt-4 grid gap-4 sm:grid-cols-2', !draft.includeReply && 'pointer-events-none opacity-50')}>
                        <FieldGroup label="ReplyToId" fieldId="inbox-composer-reply-id">
                          <Input
                            id="inbox-composer-reply-id"
                            value={draft.replyToId}
                            onChange={(event) => setDraft((current) => current ? { ...current, replyToId: event.target.value } : current)}
                            placeholder="被引用消息 ID"
                            disabled={!draft.includeReply}
                          />
                        </FieldGroup>
                        <FieldGroup label="ReplyToSender" fieldId="inbox-composer-reply-sender">
                          <Input
                            id="inbox-composer-reply-sender"
                            value={draft.replyToSender}
                            onChange={(event) => setDraft((current) => current ? { ...current, replyToSender: event.target.value } : current)}
                            placeholder="被引用发送者"
                            disabled={!draft.includeReply}
                          />
                        </FieldGroup>
                        <div className="sm:col-span-2">
                          <FieldGroup label="ReplyToBody" fieldId="inbox-composer-reply-body">
                            <Textarea
                              id="inbox-composer-reply-body"
                              value={draft.replyToBody}
                              onChange={(event) => setDraft((current) => current ? { ...current, replyToBody: event.target.value } : current)}
                              className="min-h-[96px]"
                              placeholder="被引用消息内容"
                              disabled={!draft.includeReply}
                            />
                          </FieldGroup>
                        </div>
                      </div>
                    </div>

                    <StructuredDataViewer
                      title="生成请求体预览"
                      value={payloadPreview}
                      heightClassName="h-[20rem]"
                      notice="预览只读。提交时将按这里展示的 inboundContext / rawPayload 发往 /api/inbox/simulate。"
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-border px-5 py-8 text-sm text-muted-foreground">
                请先从对象列表打开一个目标对象，再进入消息编辑抽屉。
              </div>
            )}

            {error ? (
              <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}
          </div>
        </ScrollArea>

        <SheetFooter className="border-t border-border px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            取消
          </Button>
          <Button onClick={() => void submitMessage()} disabled={isSubmitting || !draft?.body.trim()}>
            <Send className="mr-2 h-4 w-4" />
            {isSubmitting ? 'POST 中...' : 'POST 模拟消息'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default InboxMessageComposerSheet;
