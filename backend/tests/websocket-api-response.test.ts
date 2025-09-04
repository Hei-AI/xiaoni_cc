import { WebSocketClient } from '../src/services/websocket-client';
import { WebSocketConfig } from '../src/types';
import { EventEmitter } from 'events';

describe('WebSocket API Response Handling', () => {
  let webSocketClient: WebSocketClient;
  let mockWebSocket: any;
  
  beforeEach(() => {
    const config: WebSocketConfig = {
      host: '127.0.0.1',
      port: 3001,
      access_token: 'test-token',
      uri: 'ws://127.0.0.1:3001?access_token=test-token'
    };
    
    webSocketClient = new WebSocketClient(config);
    
    // Mock WebSocket
    mockWebSocket = new EventEmitter();
    mockWebSocket.readyState = 1; // OPEN
    mockWebSocket.send = jest.fn();
    mockWebSocket.close = jest.fn();
    
    // Mock the ws property
    (webSocketClient as any).ws = mockWebSocket;
  });

  it('should correctly identify and handle API response messages', (done) => {
    const apiResponse = {
      status: 'ok',
      retcode: 0,
      data: { message_id: 1234567890 },
      message: '',
      wording: '',
      echo: ''
    };

    // Listen for api_response event
    webSocketClient.on('api_response', (response) => {
      expect(response).toEqual(apiResponse);
      expect(response.status).toBe('ok');
      expect(response.retcode).toBe(0);
      expect(response.data.message_id).toBe(1234567890);
      done();
    });

    // Simulate receiving API response
    const handleMessage = (webSocketClient as any).handleMessage.bind(webSocketClient);
    handleMessage(Buffer.from(JSON.stringify(apiResponse)));
  });

  it('should not treat API responses as unknown message types', (done) => {
    const apiResponse = {
      status: 'ok',
      retcode: 0,
      data: { message_id: 1234567890 },
      message: '',
      wording: '',
      echo: ''
    };

    // Spy on moduleLogger.warn to ensure "Unknown message type" is not logged
    const warnSpy = jest.spyOn((webSocketClient as any).moduleLogger, 'warn');

    // Listen for api_response event
    webSocketClient.on('api_response', () => {
      // Check that warn was not called with "Unknown message type"
      const unknownMessageWarning = warnSpy.mock.calls.find(call => 
        call[0] === 'Unknown message type'
      );
      expect(unknownMessageWarning).toBeUndefined();
      done();
    });

    // Simulate receiving API response
    const handleMessage = (webSocketClient as any).handleMessage.bind(webSocketClient);
    handleMessage(Buffer.from(JSON.stringify(apiResponse)));
  });

  it('should handle failed API responses', (done) => {
    const failedApiResponse = {
      status: 'failed',
      retcode: 1400,
      data: null,
      message: 'Bad Request',
      wording: '请求格式错误',
      echo: ''
    };

    // Listen for api_response event
    webSocketClient.on('api_response', (response) => {
      expect(response.status).toBe('failed');
      expect(response.retcode).toBe(1400);
      expect(response.message).toBe('Bad Request');
      done();
    });

    // Simulate receiving failed API response
    const handleMessage = (webSocketClient as any).handleMessage.bind(webSocketClient);
    handleMessage(Buffer.from(JSON.stringify(failedApiResponse)));
  });

  it('should correctly identify API responses vs event messages', () => {
    const webSocketClientAny = webSocketClient as any;
    
    // API response - should return true
    const apiResponse = {
      status: 'ok',
      retcode: 0,
      data: { message_id: 123 }
    };
    expect(webSocketClientAny.isApiResponse(apiResponse)).toBe(true);

    // Event message - should return false
    const eventMessage = {
      post_type: 'message',
      message_type: 'private',
      user_id: 123456,
      message: 'Hello'
    };
    expect(webSocketClientAny.isApiResponse(eventMessage)).toBe(false);

    // Meta event - should return false
    const metaEvent = {
      post_type: 'meta_event',
      meta_event_type: 'heartbeat'
    };
    expect(webSocketClientAny.isApiResponse(metaEvent)).toBe(false);
  });
});