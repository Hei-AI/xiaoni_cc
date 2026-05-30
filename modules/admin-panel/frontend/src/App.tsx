import { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { XiaoniActivityPage } from './pages/XiaoniActivityPage';
import { ConversationsPage } from './pages/ConversationsPage';
import { RunTracePage } from './pages/RunTracePage';
import { GroupManagementPage } from './pages/GroupManagementPage';
import { GroupChatDetailPage } from './pages/GroupChatDetailPage';
import { PrivateChatManagementPage } from './pages/PrivateChatManagementPage';
import { PrivateChatDetailPage } from './pages/PrivateChatDetailPage';
import { PromptManagementPage } from './pages/PromptManagementPage';
import { PromptDetailPage } from './pages/PromptDetailPage';
import { PromptEditPage } from './pages/PromptEditPage';
import QueueManagementPage from './pages/QueueManagementPage';
import { HttpTrafficMonitorPage } from './pages/HttpTrafficMonitorPage';
import { HttpTrafficDetailPage } from './pages/HttpTrafficDetailPage';
import { ProviderRequestDesignPreviewPage } from './pages/ProviderRequestDesignPreviewPage';
import { PlaygroundPage } from './pages/PlaygroundPage';
import { ImageLabPage } from './pages/ImageLabPage';
import { CodexPoolPage } from './pages/CodexPoolPage';
import './globals.css';
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
      <Router
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Layout>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Navigate to="/xiaoni-activity" replace />} />
              <Route path="/xiaoni-activity" element={<XiaoniActivityPage />} />
              <Route path="/dashboard" element={<Navigate to="/xiaoni-activity" replace />} />
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
              <Route path="/image-lab" element={<ImageLabPage />} />
              <Route path="/operations/codex-pool" element={<CodexPoolPage />} />
            </Routes>
          </Suspense>
        </Layout>
      </Router>
    </QueryClientProvider>
  );
}

export default App;
