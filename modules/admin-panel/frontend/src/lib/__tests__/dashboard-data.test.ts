import { mapDashboardStatsPayload } from '@/hooks/useDashboardData';

describe('dashboard data mapping', () => {
  it('maps backend stats and runtime status into dashboard cards', () => {
    expect(mapDashboardStatsPayload({
      success: true,
      data: {
        total_conversations: '2129',
        active_sessions: '3',
        llm_calls_today: '411',
      },
      timestamp: '2026-04-05T07:23:27.260Z',
    }, {
      success: true,
      data: {
        status: 'healthy',
      },
    })).toEqual({
      totalMessages: 2129,
      activeGroups: 3,
      aiResponses: 411,
      systemHealth: 'healthy',
      uptime: 'online',
      timestamp: '2026-04-05T07:23:27.260Z',
    });
  });
});
