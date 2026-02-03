import * as functions from 'firebase-functions-test';
import { TestEnvironment } from './test-setup';

// Mock node-fetch
const mockFetch = jest.fn();
jest.mock('node-fetch', () => mockFetch);

// Mock console methods
const mockConsoleLog = jest.fn();
const mockConsoleError = jest.fn();

// Initialize Firebase Functions Test
const testEnv = functions();

describe('tokenExchange Function', () => {
  let envHelper: TestEnvironment;
  let wrapped: any;

  beforeAll(() => {
    console.log = mockConsoleLog;
    console.error = mockConsoleError;
    
    // Import and wrap the function
    const myFunctions = require('./index');
    wrapped = testEnv.wrap(myFunctions.tokenExchange);
  });

  afterAll(() => {
    testEnv.cleanup();
  });

  beforeEach(() => {
    envHelper = new TestEnvironment();
    envHelper.setEnvVars({
      REACT_APP_MONZO_CLIENT_ID: 'test-client-id',
      REACT_APP_MONZO_CLIENT_SECRET: 'test-client-secret',
      REACT_APP_MONZO_REDIRECT_URI: 'https://example.com/callback'
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    envHelper.restore();
  });

  describe('Input Validation', () => {
    it('should require data', async () => {
      await expect(wrapped({ data: null })).rejects.toThrow('Authorization code is required');
    });

    it('should require authorization code', async () => {
      await expect(wrapped({ data: {} })).rejects.toThrow('Authorization code is required');
    });

    it('should require non-empty authorization code', async () => {
      await expect(wrapped({ data: { code: '' } })).rejects.toThrow('Authorization code is required');
    });
  });

  describe('Successful Token Exchange', () => {
    it('should exchange authorization code for token', async () => {
      const mockToken = {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer'
      };

      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockToken)
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await wrapped({ data: { code: 'test-auth-code' } });

      expect(result).toEqual(mockToken);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.monzo.com/oauth2/token',
        expect.objectContaining({
          method: 'post',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: expect.stringContaining('grant_type=authorization_code')
        })
      );

      // Verify the request body contains all required parameters
      const requestBody = mockFetch.mock.calls[0][1].body;
      expect(requestBody).toContain('client_id=test-client-id');
      expect(requestBody).toContain('client_secret=test-client-secret');
      expect(requestBody).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fcallback');
      expect(requestBody).toContain('code=test-auth-code');
    });
  });

  describe('API Error Handling', () => {
    it('should handle 400 bad request errors', async () => {
      const mockErrorResponse = {
        error: 'invalid_request',
        error_description: 'Invalid authorization code'
      };

      const mockResponse = {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: jest.fn().mockResolvedValue(mockErrorResponse)
      };
      mockFetch.mockResolvedValue(mockResponse);

      await expect(wrapped({ data: { code: 'invalid-code' } })).rejects.toThrow('Monzo API error: 400');

      expect(mockConsoleError).toHaveBeenCalledWith('Monzo API error details:', {
        status: 400,
        statusText: 'Bad Request',
        responseData: mockErrorResponse,
        requestData: {
          grant_type: 'authorization_code',
          client_id: 'test-client-id',
          client_secret: 'test-client-secret',
          redirect_uri: 'https://example.com/callback',
          code: 'invalid-code'
        }
      });
    });

    it('should handle 401 unauthorized errors', async () => {
      const mockErrorResponse = {
        error: 'invalid_client',
        error_description: 'Invalid client credentials'
      };

      const mockResponse = {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: jest.fn().mockResolvedValue(mockErrorResponse)
      };
      mockFetch.mockResolvedValue(mockResponse);

      await expect(wrapped({ data: { code: 'test-code' } })).rejects.toThrow('Monzo API error: 401');
    });

    it('should handle 500 server errors', async () => {
      const mockErrorResponse = {
        error: 'server_error',
        error_description: 'Internal server error'
      };

      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: jest.fn().mockResolvedValue(mockErrorResponse)
      };
      mockFetch.mockResolvedValue(mockResponse);

      await expect(wrapped({ data: { code: 'test-code' } })).rejects.toThrow('Monzo API error: 500');
    });
  });

  describe('Network Error Handling', () => {
    it('should handle network errors', async () => {
      const networkError = new Error('Network error');
      mockFetch.mockRejectedValue(networkError);

      await expect(wrapped({ data: { code: 'test-code' } })).rejects.toThrow('Failed to exchange token');

      expect(mockConsoleError).toHaveBeenCalledWith('Token exchange error:', networkError);
    });

    it('should handle fetch timeout errors', async () => {
      const timeoutError = new Error('Request timeout');
      (timeoutError as any).code = 'ETIMEDOUT';
      mockFetch.mockRejectedValue(timeoutError);

      await expect(wrapped({ data: { code: 'test-code' } })).rejects.toThrow('Failed to exchange token');
    });
  });

  describe('Environment Variables', () => {
    it('should handle missing environment variables', async () => {
      envHelper.clearEnvVars(['REACT_APP_MONZO_CLIENT_ID', 'REACT_APP_MONZO_CLIENT_SECRET', 'REACT_APP_MONZO_REDIRECT_URI']);

      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ access_token: 'test-token' })
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await wrapped({ data: { code: 'test-code' } });

      expect(result).toEqual({ access_token: 'test-token' });

      // Verify empty strings are used for missing env vars
      const requestBody = mockFetch.mock.calls[0][1].body;
      expect(requestBody).toContain('client_id=');
      expect(requestBody).toContain('client_secret=');
      expect(requestBody).toContain('redirect_uri=');
    });
  });

  describe('Request Body Formatting', () => {
    it('should format request body as URL-encoded form data', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ access_token: 'test-token' })
      };
      mockFetch.mockResolvedValue(mockResponse);

      await wrapped({ data: { code: 'test-code-with-special-chars+/=' } });

      const requestBody = mockFetch.mock.calls[0][1].body;
      expect(requestBody).toContain('code=test-code-with-special-chars%2B%2F%3D');
    });

    it('should include all required OAuth parameters', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ access_token: 'test-token' })
      };
      mockFetch.mockResolvedValue(mockResponse);

      await wrapped({ data: { code: 'test-code' } });

      const requestBody = mockFetch.mock.calls[0][1].body;
      expect(requestBody).toContain('grant_type=authorization_code');
      expect(requestBody).toContain('client_id=test-client-id');
      expect(requestBody).toContain('client_secret=test-client-secret');
      expect(requestBody).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fcallback');
      expect(requestBody).toContain('code=test-code');
    });
  });

  describe('Console Logging', () => {
    it('should log the request body for debugging', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ access_token: 'test-token' })
      };
      mockFetch.mockResolvedValue(mockResponse);

      await wrapped({ data: { code: 'test-code' } });

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.any(Object));
    });
  });
});