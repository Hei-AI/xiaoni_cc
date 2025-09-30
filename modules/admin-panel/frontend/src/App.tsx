// import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversationTimelinePage } from './pages/ConversationTimelinePage';
import { ConversationsPage } from './pages/ConversationsPage';
import { DashboardPage } from './pages/DashboardPage';
import { GroupManagementPage } from './pages/GroupManagementPage';
import { GroupChatDetailPage } from './pages/GroupChatDetailPage';
import { PrivateChatManagementPage } from './pages/PrivateChatManagementPage';
import { PrivateChatDetailPage } from './pages/PrivateChatDetailPage';
import { PromptManagementPage } from './pages/PromptManagementPage';
import { PromptEditPage } from './pages/PromptEditPage';
import { PromptDebugPage } from './pages/PromptDebugPage';
import SimpleQueueMonitorPage from './pages/SimpleQueueMonitorPage';
import { HttpTrafficMonitorPage } from './pages/HttpTrafficMonitorPage';
import { HttpTrafficDetailPage } from './pages/HttpTrafficDetailPage';
import { Layout } from './components/Layout';
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
  return <Navigate to={`/prompts/${promptId}/edit`} replace />;
};

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <Layout>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/conversation/:conversationId/timeline" element={<ConversationTimelinePage />} />
            <Route path="/conversations" element={<ConversationsPage />} />
            <Route path="/groups" element={<GroupManagementPage />} />
            <Route path="/groups/:groupId" element={<GroupChatDetailPage />} />
            <Route path="/private-chats" element={<PrivateChatManagementPage />} />
            <Route path="/private-chats/:userId" element={<PrivateChatDetailPage />} />
            <Route path="/prompts" element={<PromptManagementPage />} />
            <Route path="/prompts/new" element={<PromptEditPage />} />
            <Route path="/prompts/:promptId" element={<PromptRedirect />} />
            <Route path="/prompts/:promptId/edit" element={<PromptEditPage />} />
            <Route path="/prompts/:promptId/debug" element={<PromptDebugPage />} />
            <Route path="/queue-monitor" element={<SimpleQueueMonitorPage />} />
            <Route path="/traffic" element={<HttpTrafficMonitorPage />} />
            <Route path="/traffic/:id" element={<HttpTrafficDetailPage />} />
            <Route path="/monitoring" element={<Navigate to="/dashboard" replace />} />
            <Route path="/settings" element={<Navigate to="/prompts" replace />} />
          </Routes>
        </Layout>
      </Router>
    </QueryClientProvider>
  );
}

export default App;