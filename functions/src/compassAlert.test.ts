import * as functions from 'firebase-functions-test';
import { TestEnvironment } from './test-setup';

// Mock node-fetch
const mockFetch = jest.fn();
jest.mock('node-fetch', () => mockFetch);

// Mock Secret Manager
const mockAccessSecretVersion = jest.fn();
jest.mock('@google-cloud/secret-manager', () => {
  return {
    SecretManagerServiceClient: jest.fn().mockImplementation(() => ({
      accessSecretVersion: mockAccessSecretVersion
    }))
  };
});

// Mock console methods
const mockConsoleLog = jest.fn();
const mockConsoleError = jest.fn();

// Initialize Firebase Functions Test
const testEnv = functions();

describe('compassAlert Function', () => {
  let envHelper: TestEnvironment;
  let wrapped: any;

  beforeAll(() => {
    console.log = mockConsoleLog;
    console.error = mockConsoleError;
    
    // Import and wrap the function
    const myFunctions = require('./index');
    wrapped = testEnv.wrap(myFunctions.compassAlert);
  });

  afterAll(() => {
    testEnv.cleanup();
  });

  beforeEach(() => {
    envHelper = new TestEnvironment();
    envHelper.setupCompassEnv();
    
    // Setup default Secret Manager mocks
    mockAccessSecretVersion.mockImplementation((request: any) => {
      const secretName = request.name.split('/secrets/')[1].split('/versions/')[0];
      if (secretName === 'atlassian-email') {
        return Promise.resolve([{
          payload: { data: Buffer.from('test@example.com') }
        }]);
      } else if (secretName === 'atlassian-api-key') {
        return Promise.resolve([{
          payload: { data: Buffer.from('test-api-key') }
        }]);
      }
      return Promise.reject(new Error(`Unknown secret: ${secretName}`));
    });
    
    jest.clearAllMocks();
  });

  afterEach(() => {
    envHelper.restore();
  });

  describe('Input Validation', () => {
    it('should require alert data', async () => {
      await expect(wrapped({ data: null })).rejects.toThrow('Alert data is required');
    });

    it('should require alert message', async () => {
      await expect(wrapped({ data: { context: { test: 'value' } } })).rejects.toThrow('Alert message is required');
    });

    it('should reject empty message', async () => {
      await expect(wrapped({ data: { message: '' } })).rejects.toThrow('Alert message is required');
    });

    it('should reject null message', async () => {
      await expect(wrapped({ data: { message: null } })).rejects.toThrow('Alert message is required');
    });
  });

  describe('Environment Configuration', () => {
    it('should require COMPASS_API_URL', async () => {
      envHelper.clearEnvVars(['COMPASS_API_URL']);
      
      await expect(wrapped({ data: { message: 'Test alert' } })).rejects.toThrow('Compass API URL not configured');
      
      expect(mockConsoleError).toHaveBeenCalledWith('COMPASS_API_URL not configured');
    });

    it('should require project ID for Secret Manager', async () => {
      envHelper.clearEnvVars(['GCLOUD_PROJECT']);
      
      await expect(wrapped({ data: { message: 'Test alert' } })).rejects.toThrow('Failed to retrieve Atlassian credentials');
      
      expect(mockConsoleError).toHaveBeenCalledWith('Failed to retrieve Atlassian credentials from Secret Manager:', expect.any(Error));
    });
    
    it('should handle Secret Manager failures', async () => {
      mockAccessSecretVersion.mockRejectedValue(new Error('Secret not found'));
      
      await expect(wrapped({ data: { message: 'Test alert' } })).rejects.toThrow('Failed to retrieve Atlassian credentials');
      
      expect(mockConsoleError).toHaveBeenCalledWith('Failed to retrieve Atlassian credentials from Secret Manager:', expect.any(Error));
    });
  });

  describe('Successful API Calls', () => {
    it('should send alert with minimal data', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ id: 'alert-123', status: 'created' })
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await wrapped({ data: { message: 'Test alert message' } });

      expect(result).toEqual({
        success: true,
        alertId: 'alert-123',
        timestamp: expect.any(String)
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://compass.example.com/api',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Basic dGVzdEBleGFtcGxlLmNvbTp0ZXN0LWFwaS1rZXk=',
            'User-Agent': 'mflow-compass-alert/1.0'
          },
          body: expect.stringContaining('Test alert message'),
          timeout: 10000
        })
      );
    });

    it('should send alert with full data', async () => {
      const mockResponse = {
        ok: true,
        status: 201,
        json: jest.fn().mockResolvedValue({ id: 'alert-456' })
      };
      mockFetch.mockResolvedValue(mockResponse);

      const testTimestamp = '2023-01-01T00:00:00.000Z';
      const result = await wrapped({ data: {
        message: 'Test alert with context',
        context: { userId: '123', action: 'user_login' },
        timestamp: testTimestamp,
        source: 'custom-source'
      } });

      expect(result).toEqual({
        success: true,
        alertId: 'alert-456',
        timestamp: expect.any(String)
      });

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody).toEqual({
        message: 'Test alert with context',
        description: 'Test alert with context',
        source: 'custom-source',
        entity: 'mflow',
        priority: 'P3',
        timestamp: testTimestamp,
        extraProperties: {
          mflowContext: { userId: '123', action: 'user_login' },
          timestamp: testTimestamp
        }
      });
    });

    it('should handle response without alert ID', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ status: 'created' })
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await wrapped({ data: { message: 'Test alert' } });

      expect(result).toEqual({
        success: true,
        alertId: null,
        timestamp: expect.any(String)
      });

      expect(mockConsoleLog).toHaveBeenCalledWith('Alert sent successfully to Compass:', {
        status: 200,
        alertId: 'unknown'
      });
    });
  });

  describe('API Error Handling', () => {
    it('should handle 4xx client errors without retry', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: jest.fn().mockResolvedValue({ error: 'Invalid request' })
      };
      mockFetch.mockResolvedValue(mockResponse);

      await expect(wrapped({ data: { message: 'Test alert' } })).rejects.toThrow('Compass API error: 400');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should retry on 5xx server errors', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: jest.fn().mockResolvedValue({ error: 'Server error' })
      };
      mockFetch.mockResolvedValue(mockResponse);

      await expect(wrapped({ data: { message: 'Test alert' } })).rejects.toThrow('Compass API error: 500');

      // Should retry 3 times + initial attempt = 4 total calls
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe('Network Error Handling', () => {
    it('should retry on network timeout errors', async () => {
      const networkError = new Error('Network timeout');
      (networkError as any).code = 'ETIMEDOUT';
      mockFetch.mockRejectedValue(networkError);

      await expect(wrapped({ data: { message: 'Test alert' } })).rejects.toThrow('Failed to send alert to Compass');

      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('should not retry on non-network errors', async () => {
      const otherError = new Error('Some other error');
      mockFetch.mockRejectedValue(otherError);

      await expect(wrapped({ data: { message: 'Test alert' } })).rejects.toThrow('Failed to send alert to Compass');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Retry Success Scenarios', () => {
    it('should succeed after retrying server error', async () => {
      const failureResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: jest.fn().mockResolvedValue({ error: 'Server error' })
      };
      const successResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ id: 'alert-retry-success' })
      };

      mockFetch
        .mockResolvedValueOnce(failureResponse)
        .mockResolvedValueOnce(successResponse);

      const result = await wrapped({ data: { message: 'Test alert' } });

      expect(result).toEqual({
        success: true,
        alertId: 'alert-retry-success',
        timestamp: expect.any(String)
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Payload Structure', () => {
    it('should use default values for optional fields', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ id: 'alert-123' })
      };
      mockFetch.mockResolvedValue(mockResponse);

      await wrapped({ data: { message: 'Test alert' } });

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody).toEqual({
        message: 'Test alert',
        description: 'Test alert',
        source: 'mflow-app',
        entity: 'mflow',
        priority: 'P3',
        timestamp: expect.any(String),
        extraProperties: {
          mflowContext: {},
          timestamp: expect.any(String)
        }
      });

      // Verify timestamp is valid ISO string
      expect(new Date(requestBody.timestamp).toISOString()).toBe(requestBody.timestamp);
    });
  });

  describe('Rate Limiting', () => {
    it('should handle rate limiting with retry-after header', async () => {
      const mockResponse = {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: jest.fn().mockResolvedValue({ error: 'Rate limited' }),
        headers: {
          get: jest.fn().mockReturnValue('5') // 5 seconds
        }
      };
      mockFetch.mockResolvedValue(mockResponse);

      await expect(wrapped({ data: { message: 'Test alert' } })).rejects.toThrow('Compass API error: 429');

      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('should handle rate limiting without retry-after header', async () => {
      const mockResponse = {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: jest.fn().mockResolvedValue({ error: 'Rate limited' }),
        headers: {
          get: jest.fn().mockReturnValue(null)
        }
      };
      mockFetch.mockResolvedValue(mockResponse);

      await expect(wrapped({ data: { message: 'Test alert' } })).rejects.toThrow('Compass API error: 429');

      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined context', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ id: 'alert-123' })
      };
      mockFetch.mockResolvedValue(mockResponse);

      await wrapped({ data: { message: 'Test alert', context: undefined } });

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody.extraProperties).toEqual({
        mflowContext: {},
        timestamp: expect.any(String)
      });
    });

    it('should handle null context', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ id: 'alert-123' })
      };
      mockFetch.mockResolvedValue(mockResponse);

      await wrapped({ data: { message: 'Test alert', context: null } });

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody.extraProperties).toEqual({
        mflowContext: {},
        timestamp: expect.any(String)
      });
    });

    it('should handle complex nested context', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ id: 'alert-123' })
      };
      mockFetch.mockResolvedValue(mockResponse);

      const complexContext = {
        user: { id: 123, name: 'John' },
        metadata: { tags: ['urgent', 'api'], count: 5 },
        nested: { deeply: { nested: { value: 'test' } } }
      };

      await wrapped({ data: { message: 'Test alert', context: complexContext } });

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody.extraProperties).toEqual({
        mflowContext: complexContext,
        timestamp: expect.any(String)
      });
    });

    it('should handle very long messages', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ id: 'alert-123' })
      };
      mockFetch.mockResolvedValue(mockResponse);

      const longMessage = 'A'.repeat(10000);
      await wrapped({ data: { message: longMessage } });

      expect(mockConsoleLog).toHaveBeenCalledWith('Sending alert to Compass:', {
        url: 'https://compass.example.com/api',
        source: 'mflow-app',
        messageLength: 10000
      });
    });
  });

  describe('Error Handling Edge Cases', () => {
    it('should handle JSON parsing errors in response', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: jest.fn().mockRejectedValue(new Error('Invalid JSON'))
      };
      mockFetch.mockResolvedValue(mockResponse);

      await expect(wrapped({ data: { message: 'Test alert' } })).rejects.toThrow('Failed to send alert to Compass');
    });

    it('should handle fetch errors with different error codes', async () => {
      const connectionError = new Error('Connection refused');
      (connectionError as any).code = 'ECONNREFUSED';
      mockFetch.mockRejectedValue(connectionError);

      await expect(wrapped({ data: { message: 'Test alert' } })).rejects.toThrow('Failed to send alert to Compass');

      expect(mockFetch).toHaveBeenCalledTimes(1); // Should not retry ECONNREFUSED
    });

    it('should handle fetch errors with name FetchError', async () => {
      const fetchError = new Error('Fetch failed');
      (fetchError as any).name = 'FetchError';
      mockFetch.mockRejectedValue(fetchError);

      await expect(wrapped({ data: { message: 'Test alert' } })).rejects.toThrow('Failed to send alert to Compass');

      expect(mockFetch).toHaveBeenCalledTimes(4); // Should retry FetchError
    });
  });
});