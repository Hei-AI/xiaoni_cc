import React, { useEffect, useMemo, useState } from 'react';
import { Send, Wand2 } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

export interface InboxConversationContext {
  sessionKey: string;
  chatType: 'direct' | 'group';
  peerId: string;
  peerName?: string;
  accountId: string;
  latestSenderId?: string;
  latestSenderName?: string;
}

interface QueueSimulationPanelProps {
  selectedConversation?: InboxConversationContext | null;
  onMessageSent?: () => Promise<void> | void;
}

function buildTemplate(chatType: 'direct' | 'group', selectedConversation?: InboxConversationContext | null) {
  const peerId = selectedConversation?.peerId || (chatType === 'group' ? '10000000' : '85178516');
  const accountId = selectedConversation?.accountId || '1129974489';
  const senderId = selectedConversation?.latestSenderId || (chatType === 'group' ? '85178516' : peerId);
  const senderName = selectedConversation?.latestSenderName || selectedConversation?.peerName || senderId;
  const sessionKey = selectedConversation?.sessionKey
    || (chatType === 'group' ? `qq:group:${peerId}` : `qq:direct:${accountId}:${peerId}`);
  const to = chatType === 'group' ? `group:${peerId}` : `user:${peerId}`;
  const from = chatType === 'group' ? `qq:group:${peerId}` : `qq:${senderId}`;

  return {
    inboundContext: {
      ChatType: chatType,
      AccountId: accountId,
      SenderId: senderId,
      SenderName: senderName,
      SenderUsername: senderName,
      SessionKey: sessionKey,
      NativeChannelId: peerId,
      ConversationLabel: selectedConversation?.peerName || (chatType === 'group' ? `群 ${peerId}` : `QQ ${peerId}`),
      GroupSubject: chatType === 'group' ? (selectedConversation?.peerName || `群 ${peerId}`) : undefined,
      From: from,
      To: to,
      Body: chatType === 'group' ? '@小腻 测试 inbox' : '测试 inbox',
      BodyForAgent: chatType === 'group' ? '@小腻 测试 inbox' : '测试 inbox',
      RawBody: chatType === 'group' ? '@小腻 测试 inbox' : '测试 inbox',
      CommandBody: '测试 inbox',
      BodyForCommands: '测试 inbox',
      Provider: 'qq',
      Surface: 'simulator',
      OriginatingChannel: 'qq',
      OriginatingTo: to,
      WasMentioned: chatType === 'group',
    },
    rawPayload: {
      simulated: true,
      source: 'admin-frontend'
    }
  };
}

const QueueSimulationPanel: React.FC<QueueSimulationPanelProps> = ({
  selectedConversation,
  onMessageSent,
}) => {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const conversationTemplate = useMemo(
    () => buildTemplate(selectedConversation?.chatType || 'direct', selectedConversation),
    [selectedConversation]
  );

  useEffect(() => {
    setDraft(JSON.stringify(conversationTemplate, null, 2));
    setError(null);
  }, [conversationTemplate]);

  const applyTemplate = (chatType: 'direct' | 'group') => {
    setDraft(JSON.stringify(buildTemplate(chatType, selectedConversation), null, 2));
    setError(null);
  };

  const simulateMessage = async () => {
    try {
      setIsSubmitting(true);
      setError(null);

      const parsed = JSON.parse(draft) as Record<string, unknown>;
      const response = await fetch('/api/inbox/simulate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(parsed),
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Simulation request failed');
      }

      if (onMessageSent) {
        await onMessageSent();
      }
    } catch (simulationError) {
      setError(simulationError instanceof Error ? simulationError.message : 'Simulation request failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold">内部消息体模拟器</h3>
          <p className="text-sm text-muted-foreground">
            直接提交 `inboundContext` JSON，验证 provider inbox 接入链路。
          </p>
        </div>
        {selectedConversation ? (
          <div className="text-right text-xs text-muted-foreground">
            <div>{selectedConversation.chatType === 'group' ? '群聊' : '私聊'}</div>
            <div className="font-mono">{selectedConversation.sessionKey}</div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => applyTemplate('direct')}>
          <Wand2 className="mr-2 h-4 w-4" />
          私聊模板
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => applyTemplate('group')}>
          <Wand2 className="mr-2 h-4 w-4" />
          群聊模板
        </Button>
        {selectedConversation ? (
          <Button type="button" variant="outline" size="sm" onClick={() => applyTemplate(selectedConversation.chatType)}>
            <Wand2 className="mr-2 h-4 w-4" />
            当前会话模板
          </Button>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">请求体 JSON</div>
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="min-h-[26rem] font-mono text-xs leading-6"
          spellCheck={false}
        />
      </div>

      {error ? <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}

      <Button onClick={simulateMessage} className="w-full" disabled={isSubmitting}>
        <Send className="mr-2 h-4 w-4" />
        {isSubmitting ? '提交中...' : '提交到 Inbox'}
      </Button>
    </div>
  );
};

export default QueueSimulationPanel;
