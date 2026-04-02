import { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import './globals.css';

const DashboardPage = lazy(async () => ({
  default: (await import('./pages/DashboardPage')).DashboardPage,
}));
const ConversationsPage = lazy(async () => ({
  default: (await import('./pages/ConversationsPage')).ConversationsPage,
}));
const RunTracePage = lazy(async () => ({
  default: (await import('./pages/RunTracePage')).RunTracePage,
}));
const GroupManagementPage = lazy(async () => ({
  default: (await import('./pages/GroupManagementPage')).GroupManagementPage,
}));
const GroupChatDetailPage = lazy(async () => ({
  default: (await import('./pages/GroupChatDetailPage')).GroupChatDetailPage,
}));
const PrivateChatManagementPage = lazy(async () => ({
  default: (await import('./pages/PrivateChatManagementPage')).PrivateChatManagementPage,
}));
const PrivateChatDetailPage = lazy(async () => ({
  default: (await import('./pages/PrivateChatDetailPage')).PrivateChatDetailPage,
}));
const PromptManagementPage = lazy(async () => ({
  default: (await import('./pages/PromptManagementPage')).PromptManagementPage,
}));
const PromptDetailPage = lazy(async () => ({
  default: (await import('./pages/PromptDetailPage')).PromptDetailPage,
}));
const PromptEditPage = lazy(async () => ({
  default: (await import('./pages/PromptEditPage')).PromptEditPage,
}));
const QueueManagementPage = lazy(() => import('./pages/QueueManagementPage'));
const HttpTrafficMonitorPage = lazy(async () => ({
  default: (await import('./pages/HttpTrafficMonitorPage')).HttpTrafficMonitorPage,
}));
const HttpTrafficDetailPage = lazy(async () => ({
  default: (await import('./pages/HttpTrafficDetailPage')).HttpTrafficDetailPage,
}));
const ProviderRequestDesignPreviewPage = lazy(async () => ({
  default: (await import('./pages/ProviderRequestDesignPreviewPage')).ProviderRequestDesignPreviewPage,
}));
const PlaygroundPage = lazy(async () => ({
  default: (await import('./pages/PlaygroundPage')).PlaygroundPage,
}));
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const PromptRedirect: React.FC = () => {
  const { promptId } = useParams<{ promptId: string }>();
  return <Navigate to={`/prompts/${promptId}/detail`} replace />;
};

const PromptDebugRedirect: React.FC = () => {
  const { promptId } = useParams<{ promptId: string }>();
  return <Navigate to={`/playground?promptId=${promptId}`} replace />;
};

const ConversationTimelineRedirect: React.FC = () => {
  const { conversationId } = useParams<{ conversationId: string }>();
  return conversationId ? <Navigate to={`/runs/${conversationId}/trace`} replace /> : <Navigate to="/conversations" replace />;
};

function RouteFallback() {
  return (
    <div className="flex min-h-[calc(100vh-12rem)] items-center justify-center px-6">
      <div className="rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
        Loading page...
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <Layout>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/conversations" element={<ConversationsPage />} />
              <Route path="/conversation/:conversationId/timeline" element={<ConversationTimelineRedirect />} />
              <Route path="/runs/:runId/trace" element={<RunTracePage />} />
              <Route path="/groups" element={<GroupManagementPage />} />
              <Route path="/groups/:groupId" element={<GroupChatDetailPage />} />
              <Route path="/private-chats" element={<PrivateChatManagementPage />} />
              <Route path="/private-chats/:userId" element={<PrivateChatDetailPage />} />
              <Route path="/prompts" element={<PromptManagementPage />} />
              <Route path="/prompts/new" element={<PromptEditPage />} />
              <Route path="/prompts/:promptId" element={<PromptRedirect />} />
              <Route path="/prompts/:promptId/detail" element={<PromptDetailPage />} />
              <Route path="/prompts/:promptId/edit" element={<PromptEditPage />} />
              <Route path="/prompts/:promptId/debug" element={<PromptDebugRedirect />} />
              <Route path="/queue-management" element={<QueueManagementPage />} />
              <Route path="/traffic" element={<HttpTrafficMonitorPage />} />
              <Route path="/traffic/:id" element={<HttpTrafficDetailPage />} />
              <Route path="/design/provider-request-preview" element={<ProviderRequestDesignPreviewPage />} />
              <Route path="/playground" element={<PlaygroundPage />} />
            </Routes>
          </Suspense>
        </Layout>
      </Router>
    </QueryClientProvider>
  );
}

export default App;
