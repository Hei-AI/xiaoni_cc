// import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversationTimelinePage } from './pages/ConversationTimelinePage';
import { DashboardPage } from './pages/DashboardPage';
import { GroupManagementPage } from './pages/GroupManagementPage';
import { GroupChatDetailPage } from './pages/GroupChatDetailPage';
import { PrivateChatManagementPage } from './pages/PrivateChatManagementPage';
import { PrivateChatDetailPage } from './pages/PrivateChatDetailPage';
import { PromptManagementPage } from './pages/PromptManagementPage';
import { PromptDetailPage } from './pages/PromptDetailPage';
import { PromptEditPage } from './pages/PromptEditPage';
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

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <Layout>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/conversation/:conversationId/timeline" element={<ConversationTimelinePage />} />
            <Route path="/groups" element={<GroupManagementPage />} />
            <Route path="/groups/:groupId" element={<GroupChatDetailPage />} />
            <Route path="/private-chats" element={<PrivateChatManagementPage />} />
            <Route path="/private-chats/:userId" element={<PrivateChatDetailPage />} />
            <Route path="/prompts" element={<PromptManagementPage />} />
            <Route path="/prompts/:promptId" element={<PromptDetailPage />} />
            <Route path="/prompts/:promptId/edit" element={<PromptEditPage />} />
          </Routes>
        </Layout>
      </Router>
    </QueryClientProvider>
  );
}

export default App;