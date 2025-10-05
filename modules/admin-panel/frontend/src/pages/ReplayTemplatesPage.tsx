import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription } from '../components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import {
  FileText,
  Plus,
  Edit,
  Trash2,
  RefreshCw,
  AlertCircle,
  Search,
} from 'lucide-react';
import type { ReplayTemplate } from '../types/traffic-replay';

export function ReplayTemplatesPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [apiTypeFilter, setApiTypeFilter] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ReplayTemplate | null>(null);

  // 表单状态
  const [formData, setFormData] = useState({
    template_name: '',
    description: '',
    target_api_type: '',
    target_host_pattern: '',
    target_path_pattern: '',
    header_modifications: '',
    body_modifications: '',
    query_modifications: '',
    url_replacement_pattern: '',
    url_replacement_value: '',
  });

  const [formError, setFormError] = useState('');

  // 获取模板列表
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['replay-templates', searchQuery, apiTypeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      if (apiTypeFilter) params.append('api_type', apiTypeFilter);

      const response = await fetch(
        `/api/traffic/replay/templates?${params.toString()}`
      );
      if (!response.ok) throw new Error('Failed to fetch templates');
      return response.json();
    },
  });

  // 创建模板
  const createMutation = useMutation({
    mutationFn: async (templateData: any) => {
      const response = await fetch(`/api/traffic/replay/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(templateData),
      });
      if (!response.ok) throw new Error('Failed to create template');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['replay-templates'] });
      setShowCreateDialog(false);
      resetForm();
    },
  });

  // 更新模板
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const response = await fetch(
        `/api/traffic/replay/templates/${id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      );
      if (!response.ok) throw new Error('Failed to update template');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['replay-templates'] });
      setEditingTemplate(null);
      resetForm();
    },
  });

  // 删除模板
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(
        `/api/traffic/replay/templates/${id}`,
        { method: 'DELETE' }
      );
      if (!response.ok) throw new Error('Failed to delete template');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['replay-templates'] });
    },
  });

  const templates: ReplayTemplate[] = data?.data || [];

  const resetForm = () => {
    setFormData({
      template_name: '',
      description: '',
      target_api_type: '',
      target_host_pattern: '',
      target_path_pattern: '',
      header_modifications: '',
      body_modifications: '',
      query_modifications: '',
      url_replacement_pattern: '',
      url_replacement_value: '',
    });
    setFormError('');
  };

  const handleCreateOrUpdate = () => {
    setFormError('');

    // 验证必填字段
    if (!formData.template_name.trim()) {
      setFormError('模板名称不能为空');
      return;
    }

    // 解析 JSON 字段
    const templateData: any = {
      template_name: formData.template_name,
      description: formData.description,
      target_api_type: formData.target_api_type || null,
      target_host_pattern: formData.target_host_pattern || null,
      target_path_pattern: formData.target_path_pattern || null,
      url_replacement_pattern: formData.url_replacement_pattern || null,
      url_replacement_value: formData.url_replacement_value || null,
    };

    // 解析 JSON 字段
    try {
      if (formData.header_modifications.trim()) {
        templateData.header_modifications = JSON.parse(
          formData.header_modifications
        );
      }
      if (formData.body_modifications.trim()) {
        templateData.body_modifications = JSON.parse(formData.body_modifications);
      }
      if (formData.query_modifications.trim()) {
        templateData.query_modifications = JSON.parse(
          formData.query_modifications
        );
      }
    } catch (err) {
      setFormError('JSON 格式错误，请检查修改规则');
      return;
    }

    if (editingTemplate) {
      updateMutation.mutate({ id: editingTemplate.id, data: templateData });
    } else {
      createMutation.mutate(templateData);
    }
  };

  const handleEdit = (template: ReplayTemplate) => {
    setEditingTemplate(template);
    setFormData({
      template_name: template.template_name,
      description: template.description || '',
      target_api_type: template.target_api_type || '',
      target_host_pattern: template.target_host_pattern || '',
      target_path_pattern: template.target_path_pattern || '',
      header_modifications: template.header_modifications
        ? JSON.stringify(template.header_modifications, null, 2)
        : '',
      body_modifications: template.body_modifications
        ? JSON.stringify(template.body_modifications, null, 2)
        : '',
      query_modifications: template.query_modifications
        ? JSON.stringify(template.query_modifications, null, 2)
        : '',
      url_replacement_pattern: template.url_replacement_pattern || '',
      url_replacement_value: template.url_replacement_value || '',
    });
    setShowCreateDialog(true);
  };

  const handleDelete = (id: number) => {
    if (confirm('确定要删除这个模板吗？')) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">重放模板管理</h1>
            <p className="text-muted-foreground">
              管理流量重放的参数修改模板，提高重放效率
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw
              className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`}
            />
            刷新
          </Button>
          <Button
            onClick={() => {
              resetForm();
              setShowCreateDialog(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            新建模板
          </Button>
        </div>
      </div>

      {/* 搜索和筛选 */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索模板名称..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={apiTypeFilter} onValueChange={setApiTypeFilter}>
              <SelectTrigger>
                <SelectValue placeholder="筛选 API 类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">全部类型</SelectItem>
                <SelectItem value="gemini">Gemini</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="claude">Claude</SelectItem>
                <SelectItem value="all">通用</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* 模板列表 */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin mr-2" />
          <span>加载中...</span>
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            加载失败: {error instanceof Error ? error.message : '未知错误'}
          </AlertDescription>
        </Alert>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>暂无模板</p>
            <p className="text-sm mt-2">点击右上角"新建模板"创建第一个模板</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {templates.map((template) => (
            <Card key={template.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2">
                      {template.template_name}
                      {!template.is_active && (
                        <Badge variant="secondary">已禁用</Badge>
                      )}
                      {template.target_api_type && (
                        <Badge variant="outline" className="capitalize">
                          {template.target_api_type}
                        </Badge>
                      )}
                    </CardTitle>
                    {template.description && (
                      <p className="text-sm text-muted-foreground mt-2">
                        {template.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(template)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(template.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {/* 匹配规则 */}
                  <div>
                    <h4 className="text-sm font-medium mb-2">匹配规则:</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {template.target_host_pattern && (
                        <div>
                          <span className="text-muted-foreground">主机:</span>{' '}
                          <code className="px-1 py-0.5 bg-muted rounded text-xs">
                            {template.target_host_pattern}
                          </code>
                        </div>
                      )}
                      {template.target_path_pattern && (
                        <div>
                          <span className="text-muted-foreground">路径:</span>{' '}
                          <code className="px-1 py-0.5 bg-muted rounded text-xs">
                            {template.target_path_pattern}
                          </code>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 修改规则 */}
                  <div>
                    <h4 className="text-sm font-medium mb-2">修改规则:</h4>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {template.header_modifications && (
                        <Badge variant="secondary">修改 Headers</Badge>
                      )}
                      {template.body_modifications && (
                        <Badge variant="secondary">修改 Body</Badge>
                      )}
                      {template.query_modifications && (
                        <Badge variant="secondary">修改 Query</Badge>
                      )}
                      {template.url_replacement_pattern && (
                        <Badge variant="secondary">替换 URL</Badge>
                      )}
                    </div>
                  </div>

                  {/* 统计信息 */}
                  <div className="flex items-center justify-between pt-2 border-t text-xs text-muted-foreground">
                    <span>使用次数: {template.usage_count}</span>
                    <span>
                      创建于: {new Date(template.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 创建/编辑对话框 */}
      <Dialog
        open={showCreateDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowCreateDialog(false);
            setEditingTemplate(null);
            resetForm();
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? '编辑模板' : '新建模板'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* 基本信息 */}
            <div className="space-y-2">
              <Label htmlFor="template_name">模板名称 *</Label>
              <Input
                id="template_name"
                value={formData.template_name}
                onChange={(e) =>
                  setFormData({ ...formData, template_name: e.target.value })
                }
                placeholder="例如: Gemini Token 刷新"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">描述</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="描述这个模板的用途..."
                rows={2}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="target_api_type">目标 API 类型</Label>
                <Select
                  value={formData.target_api_type}
                  onValueChange={(value) =>
                    setFormData({ ...formData, target_api_type: value })
                  }
                >
                  <SelectTrigger id="target_api_type">
                    <SelectValue placeholder="选择类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">不限</SelectItem>
                    <SelectItem value="gemini">Gemini</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="claude">Claude</SelectItem>
                    <SelectItem value="all">通用</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="target_host_pattern">主机匹配模式</Label>
                <Input
                  id="target_host_pattern"
                  value={formData.target_host_pattern}
                  onChange={(e) =>
                    setFormData({ ...formData, target_host_pattern: e.target.value })
                  }
                  placeholder="*.googleapis.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="target_path_pattern">路径匹配模式</Label>
                <Input
                  id="target_path_pattern"
                  value={formData.target_path_pattern}
                  onChange={(e) =>
                    setFormData({ ...formData, target_path_pattern: e.target.value })
                  }
                  placeholder="/v1/*"
                />
              </div>
            </div>

            {/* 修改规则 */}
            <div className="space-y-2">
              <Label htmlFor="header_modifications">
                Headers 修改规则 (JSON)
              </Label>
              <Textarea
                id="header_modifications"
                value={formData.header_modifications}
                onChange={(e) =>
                  setFormData({ ...formData, header_modifications: e.target.value })
                }
                placeholder='{"add": {"Authorization": "Bearer token"}, "remove": ["X-Old-Header"]}'
                rows={3}
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="body_modifications">Body 修改规则 (JSON)</Label>
              <Textarea
                id="body_modifications"
                value={formData.body_modifications}
                onChange={(e) =>
                  setFormData({ ...formData, body_modifications: e.target.value })
                }
                placeholder='{"set": {"$.user.name": "new_name"}}'
                rows={3}
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="query_modifications">Query 修改规则 (JSON)</Label>
              <Textarea
                id="query_modifications"
                value={formData.query_modifications}
                onChange={(e) =>
                  setFormData({ ...formData, query_modifications: e.target.value })
                }
                placeholder='{"add": {"debug": "true"}}'
                rows={3}
                className="font-mono text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="url_replacement_pattern">URL 替换模式 (正则)</Label>
                <Input
                  id="url_replacement_pattern"
                  value={formData.url_replacement_pattern}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      url_replacement_pattern: e.target.value,
                    })
                  }
                  placeholder="api\\.example\\.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="url_replacement_value">URL 替换值</Label>
                <Input
                  id="url_replacement_value"
                  value={formData.url_replacement_value}
                  onChange={(e) =>
                    setFormData({ ...formData, url_replacement_value: e.target.value })
                  }
                  placeholder="test-api.example.com"
                />
              </div>
            </div>

            {formError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCreateDialog(false);
                setEditingTemplate(null);
                resetForm();
              }}
            >
              取消
            </Button>
            <Button
              onClick={handleCreateOrUpdate}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending
                ? '保存中...'
                : editingTemplate
                ? '更新'
                : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
