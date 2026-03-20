import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from './EmptyState';

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = '数据加载失败',
  description = '刷新后重试，或检查后端接口状态。',
  onRetry,
}: ErrorStateProps) {
  return (
    <EmptyState
      icon={<AlertTriangle className="h-10 w-10" />}
      title={title}
      description={description}
      action={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            重试
          </Button>
        ) : null
      }
    />
  );
}
