import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  MessageCircle,
  RefreshCw,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/console/PageShell';
import { PageHeader } from '@/components/console/PageHeader';
import { FilterBar } from '@/components/console/FilterBar';
import { MetricCard } from '@/components/console/MetricCard';
import { SectionPanel } from '@/components/console/SectionPanel';
import { EntityCard } from '@/components/console/EntityCard';
import { EmptyState } from '@/components/console/EmptyState';
import { ErrorState } from '@/components/console/ErrorState';
import { StatusPill } from '@/components/console/StatusPill';
import { formatTimestamp } from '@/lib/utils';
import { useConversations } from '../hooks/useDashboardData';

export const ConversationsPage: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [showFilters] = useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
      setCurrentPage(1);
    }, 400);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  const conversationsQuery = useConversations({
    limit: itemsPerPage,
    page: currentPage,
    search: debouncedSearchTerm || undefined,
    sortBy: 'timestamp',
    sortOrder: 'desc',
  });

  const { data: conversationsData, isLoading, error } = conversationsQuery;
  const conversations = conversationsData?.data || [];
  const totalConversations = conversationsData?.total || 0;
  const totalPages = Math.max(1, Math.ceil(totalConversations / itemsPerPage));

  const stats = useMemo(() => {
    const responded = conversations.filter((conversation) => conversation.ai_response).length;
    const avgLatency =
      conversations.length > 0
        ? Math.round(conversations.reduce((sum, conversation) => sum + (conversation.response_time || 0), 0) / conversations.length)
        : 0;
    const activeUsers = new Set(conversations.map((conversation) => conversation.user_id)).size;

    return { responded, avgLatency, activeUsers };
  }, [conversations]);
  const paginationControls = (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={currentPage === 1}>
        <ChevronLeft className="mr-1 h-4 w-4" />
        上一页
      </Button>
      <StatusPill tone="info">
        {currentPage} / {totalPages}
      </StatusPill>
      <Button variant="outline" size="sm" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={currentPage >= totalPages}>
        下一页
        <ChevronRight className="ml-1 h-4 w-4" />
      </Button>
    </div>
  );

  return (
    <PageShell>
      <PageHeader
        eyebrow="Conversation Tape"
        title="对话管理"
        description="把 QQ 机器人的消息流收进统一时间带中，支持快速筛选、分页和时间线追踪。"
        icon={<MessageCircle className="h-5 w-5" />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => conversationsQuery.refetch()} disabled={isLoading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              刷新
            </Button>
            <Button variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" />
              导出
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="总对话数" value={totalConversations.toLocaleString()} icon={<MessageCircle className="h-5 w-5" />} />
        <MetricCard label="已响应" value={stats.responded} detail={`${Math.max(conversations.length - stats.responded, 0)} 条未响应`} icon={<RefreshCw className="h-5 w-5" />} tone="success" />
        <MetricCard label="平均延迟" value={`${stats.avgLatency}ms`} icon={<Filter className="h-5 w-5" />} tone="warning" />
        <MetricCard label="活跃用户" value={stats.activeUsers} icon={<MessageCircle className="h-5 w-5" />} />
      </div>

      <FilterBar>
        <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1 xl:max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索对话内容、用户 ID 或消息关键词"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <select
              value={itemsPerPage}
              onChange={(e) => {
                setItemsPerPage(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="h-9 rounded-lg border border-input bg-card px-3 text-sm text-foreground shadow-sm"
            >
              <option value={10}>10 / 页</option>
              <option value={20}>20 / 页</option>
              <option value={50}>50 / 页</option>
              <option value={100}>100 / 页</option>
            </select>
            <Button variant="outline" size="sm">
              <Filter className="mr-2 h-4 w-4" />
              筛选
            </Button>
          </div>
          <div className="sm:hidden">{paginationControls}</div>
        </div>
        {showFilters ? null : null}
      </FilterBar>

      <SectionPanel
        title="对话记录"
        description="移动端改为实体卡片，桌面端保留高密度信息和快速跳转。"
        icon={<MessageCircle className="h-4 w-4 text-primary" />}
        action={<div className="hidden sm:block">{paginationControls}</div>}
      >
        {error ? (
          <ErrorState description={error.message} onRetry={() => conversationsQuery.refetch()} />
        ) : isLoading ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="terminal-card h-44 animate-pulse rounded-xl bg-muted/60" />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <EmptyState
            icon={<MessageCircle className="h-10 w-10" />}
            title={searchTerm ? '没有找到匹配对话' : '暂无对话数据'}
            description={searchTerm ? '缩短关键词或尝试搜索用户 ID。' : '当机器人开始处理消息时，这里会出现新的会话记录。'}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {conversations.map((conversation) => (
              <EntityCard
                key={conversation.id}
                title={`用户 ${conversation.user_id}`}
                subtitle={formatTimestamp(conversation.timestamp)}
                badges={
                  <>
                    {conversation.model_name && <Badge variant="outline">{conversation.model_name}</Badge>}
                    <StatusPill tone={conversation.ai_response ? 'success' : 'warning'}>
                      {conversation.ai_response ? '已响应' : '未响应'}
                    </StatusPill>
                  </>
                }
                action={
                  <Link to={`/conversation/${conversation.id}/timeline`}>
                    <Button size="sm">时间线</Button>
                  </Link>
                }
                meta={
                  <>
                    <span>ID {conversation.id}</span>
                    <span>响应 {conversation.response_time || 0}ms</span>
                  </>
                }
              >
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Question</p>
                  <p className="mt-2 line-clamp-3 text-sm text-foreground">{conversation.user_message}</p>
                </div>
                <div className="rounded-lg border border-primary/15 bg-primary/5 p-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-primary">Answer</p>
                  <p className="mt-2 line-clamp-4 text-sm text-foreground">{conversation.ai_response || '暂无 AI 回复'}</p>
                </div>
              </EntityCard>
            ))}
          </div>
        )}
      </SectionPanel>
    </PageShell>
  );
};
