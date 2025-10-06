import React, { useEffect, useMemo, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';
import { Send } from 'lucide-react';

type SimulationType = 'private' | 'group';
type SimulationPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export interface QueueSimulationContext {
  name: string;
  type: 'private' | 'group';
  userId?: number;
  groupId?: number;
}

export interface QueueSimulationOption {
  label: string;
  value: number;
}

interface QueueSimulationPanelProps {
  selectedQueue?: QueueSimulationContext | null;
  availableUsers?: QueueSimulationOption[];
  availableGroups?: QueueSimulationOption[];
  onMessageSent?: () => Promise<void> | void;
}

interface SimulationFormState {
  type: SimulationType;
  userId: string;
  userSelectionMode: 'custom' | 'predefined';
  groupId: string;
  groupSelectionMode: 'custom' | 'predefined';
  message: string;
  priority: SimulationPriority;
  atBot: boolean;
}

const initialFormState: SimulationFormState = {
  type: 'private',
  userId: '',
  userSelectionMode: 'custom',
  groupId: '',
  groupSelectionMode: 'custom',
  message: '',
  priority: 'HIGH',
  atBot: false,
};

const QueueSimulationPanel: React.FC<QueueSimulationPanelProps> = ({
  selectedQueue,
  availableUsers = [],
  availableGroups = [],
  onMessageSent,
}) => {
  const [formState, setFormState] = useState<SimulationFormState>(initialFormState);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = useMemo(() => {
    if (!formState.userId || !formState.message.trim()) {
      return false;
    }

    if (formState.type === 'group' && !formState.groupId) {
      return false;
    }

    return true;
  }, [formState.groupId, formState.message, formState.type, formState.userId]);

  useEffect(() => {
    if (!selectedQueue) {
      return;
    }

    const userIdStr = selectedQueue.userId ? String(selectedQueue.userId) : '';
    const groupIdStr = selectedQueue.groupId ? String(selectedQueue.groupId) : '';

    const hasUserOption = !!userIdStr && availableUsers.some((option) => String(option.value) === userIdStr);
    const hasGroupOption = !!groupIdStr && availableGroups.some((option) => String(option.value) === groupIdStr);

    setFormState((prev) => ({
      ...prev,
      type: selectedQueue.type,
      userId: userIdStr,
      userSelectionMode: hasUserOption ? 'predefined' : 'custom',
      groupId: groupIdStr,
      groupSelectionMode: hasGroupOption ? 'predefined' : 'custom',
      message: '',
      atBot: false,
    }));
  }, [selectedQueue?.name, selectedQueue?.type, selectedQueue?.userId, selectedQueue?.groupId, availableUsers, availableGroups]);

  const handleUserPresetChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    if (value === '__custom__') {
      setFormState((prev) => ({
        ...prev,
        userSelectionMode: 'custom',
        userId: '',
      }));
    } else {
      setFormState((prev) => ({
        ...prev,
        userSelectionMode: 'predefined',
        userId: value,
      }));
    }
  };

  const handleGroupPresetChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    if (value === '__custom__') {
      setFormState((prev) => ({
        ...prev,
        groupSelectionMode: 'custom',
        groupId: '',
      }));
    } else {
      setFormState((prev) => ({
        ...prev,
        groupSelectionMode: 'predefined',
        groupId: value,
      }));
    }
  };

  const simulateMessage = async () => {
    if (!canSubmit) {
      return;
    }

    const endpoint = formState.type === 'private'
      ? '/api/simple-queue/simulate/private'
      : '/api/simple-queue/simulate/group';

    const payload = formState.type === 'private'
      ? {
          user_id: Number(formState.userId),
          message: formState.message,
          priority: formState.priority,
        }
      : {
          user_id: Number(formState.userId),
          group_id: Number(formState.groupId),
          message: formState.message,
          atBot: formState.atBot,
          priority: formState.priority,
        };

    try {
      setIsSubmitting(true);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Simulation request failed');
      }

      setFormState((prev) => ({
        ...prev,
        message: '',
      }));

      if (onMessageSent) {
        await onMessageSent();
      }
    } catch (error) {
      console.error('Failed to simulate message:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-semibold">消息模拟器</h3>
          <p className="text-sm text-muted-foreground">
            模拟私聊或群聊消息以验证队列处理流程
          </p>
        </div>
        {selectedQueue && (
          <div className="text-xs text-muted-foreground text-right">
            <div>当前队列: {selectedQueue.name}</div>
            <div>
              类型: {selectedQueue.type === 'group' ? '群聊' : '私聊'}
            </div>
          </div>
        )}
      </div>

      <div className="flex space-x-4">
        <label className="flex items-center space-x-2">
          <input
            type="radio"
            value="private"
            checked={formState.type === 'private'}
            onChange={(event) =>
              setFormState((prev) => ({
                ...prev,
                type: event.target.value as SimulationType,
              }))
            }
          />
          <span>私聊消息</span>
        </label>
        <label className="flex items-center space-x-2">
          <input
            type="radio"
            value="group"
            checked={formState.type === 'group'}
            onChange={(event) =>
              setFormState((prev) => ({
                ...prev,
                type: event.target.value as SimulationType,
              }))
            }
          />
          <span>群聊消息</span>
        </label>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">用户ID</label>
        <div className="space-y-2">
          <select
            className="w-full p-2 border rounded-md"
            value={formState.userSelectionMode === 'predefined' ? formState.userId : '__custom__'}
            onChange={handleUserPresetChange}
          >
            <option value="__custom__">自定义输入</option>
            {availableUsers.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Input
            type="number"
            placeholder="输入用户QQ号"
            value={formState.userId}
            onChange={(event) =>
              setFormState((prev) => ({
                ...prev,
                userSelectionMode: 'custom',
                userId: event.target.value,
              }))
            }
          />
        </div>
      </div>

      {formState.type === 'group' && (
        <>
          <div>
            <label className="block text-sm font-medium mb-1">群组ID</label>
            <div className="space-y-2">
              <select
                className="w-full p-2 border rounded-md"
                value={formState.groupSelectionMode === 'predefined' ? formState.groupId : '__custom__'}
                onChange={handleGroupPresetChange}
              >
                <option value="__custom__">自定义输入</option>
                {availableGroups.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <Input
                type="number"
                placeholder="输入群聊号"
                value={formState.groupId}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    groupSelectionMode: 'custom',
                    groupId: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              checked={formState.atBot}
              onCheckedChange={(checked) =>
                setFormState((prev) => ({
                  ...prev,
                  atBot: checked,
                }))
              }
            />
            <span className="text-sm">@机器人</span>
          </div>
        </>
      )}

      <div>
        <label className="block text-sm font-medium mb-1">消息内容</label>
        <Textarea
          placeholder="输入要模拟的消息内容"
          value={formState.message}
          onChange={(event) =>
            setFormState((prev) => ({
              ...prev,
              message: event.target.value,
            }))
          }
          rows={3}
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">优先级</label>
        <select
          className="w-full p-2 border rounded-md"
          value={formState.priority}
          onChange={(event) =>
            setFormState((prev) => ({
              ...prev,
              priority: event.target.value as SimulationPriority,
            }))
          }
        >
          <option value="HIGH">高优先级</option>
          <option value="MEDIUM">中优先级</option>
          <option value="LOW">低优先级</option>
        </select>
      </div>

      <Button
        onClick={simulateMessage}
        className="w-full"
        disabled={!canSubmit || isSubmitting}
      >
        <Send className="w-4 h-4 mr-2" />
        {isSubmitting ? '发送中...' : '发送模拟消息'}
      </Button>
    </div>
  );
};

export default QueueSimulationPanel;
