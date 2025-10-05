import { useQuery } from '@tanstack/react-query';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { FileText, AlertCircle } from 'lucide-react';
import type { ReplayTemplate } from '../types/traffic-replay';

interface TemplateSelectorProps {
  apiType?: string;
  onTemplateSelect: (template: ReplayTemplate) => void;
  disabled?: boolean;
}

export function TemplateSelector({
  apiType,
  onTemplateSelect,
  disabled = false
}: TemplateSelectorProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['replay-templates', apiType],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (apiType) {
        params.append('api_type', apiType);
      }
      params.append('is_active', 'true');

      const response = await fetch(
        `/api/traffic/replay/templates?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch templates');
      }

      return response.json();
    },
  });

  const templates: ReplayTemplate[] = data?.data || [];

  const handleTemplateChange = (templateId: string) => {
    const template = templates.find(t => t.id.toString() === templateId);
    if (template) {
      onTemplateSelect(template);
    }
  };

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          加载模板失败: {error instanceof Error ? error.message : '未知错误'}
        </AlertDescription>
      </Alert>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Label>从模板加载</Label>
        <Select disabled>
          <SelectTrigger>
            <SelectValue placeholder="加载中..." />
          </SelectTrigger>
        </Select>
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <Alert>
        <FileText className="h-4 w-4" />
        <AlertDescription>
          暂无可用模板
          {apiType && ` (${apiType} API)`}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="template-selector">从模板加载</Label>
        <Button
          variant="link"
          size="sm"
          onClick={() => window.open('/replay-templates', '_blank')}
        >
          管理模板
        </Button>
      </div>

      <Select
        onValueChange={handleTemplateChange}
        disabled={disabled}
      >
        <SelectTrigger id="template-selector">
          <SelectValue placeholder="选择模板..." />
        </SelectTrigger>
        <SelectContent>
          {templates.map((template) => (
            <SelectItem key={template.id} value={template.id.toString()}>
              <div className="flex items-center justify-between w-full">
                <span>{template.template_name}</span>
                <div className="flex items-center gap-2 ml-4">
                  {template.target_api_type && (
                    <Badge variant="outline" className="text-xs">
                      {template.target_api_type}
                    </Badge>
                  )}
                  <Badge variant="secondary" className="text-xs">
                    使用 {template.usage_count} 次
                  </Badge>
                </div>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {templates.length > 0 && (
        <p className="text-xs text-muted-foreground">
          共 {templates.length} 个可用模板
        </p>
      )}
    </div>
  );
}
