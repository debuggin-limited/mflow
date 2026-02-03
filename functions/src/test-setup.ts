/**
 * Test setup utilities for Firebase Cloud Functions
 */

import * as functions from 'firebase-functions-test';
import * as admin from 'firebase-admin';

// Initialize Firebase Functions Test
export const testEnv = functions();

// Mock console methods to avoid noise in tests
export const mockConsole = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn()
};

// Store original console methods
export const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info
};

/**
 * Setup function to be called before each test
 */
export const setupTest = () => {
  // Mock console methods
  console.log = mockConsole.log;
  console.error = mockConsole.error;
  console.warn = mockConsole.warn;
  console.info = mockConsole.info;
  
  // Clear all mocks
  jest.clearAllMocks();
};

/**
 * Teardown function to be called after each test
 */
export const teardownTest = () => {
  // Restore console methods
  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
  console.info = originalConsole.info;
};

/**
 * Global setup for all tests
 */
export const setupGlobal = () => {
  // Initialize Firebase Admin SDK
  if (!admin.apps.length) {
    admin.initializeApp();
  }
};

/**
 * Global teardown for all tests
 */
export const teardownGlobal = () => {
  // Cleanup Firebase Functions Test
  testEnv.cleanup();
};

/**
 * Create a mock HTTP request for testing
 */
export const createMockRequest = (data: any = {}) => {
  return {
    data,
    auth: {
      uid: 'test-uid',
      token: {}
    },
    rawRequest: {
      headers: {},
      method: 'POST',
      url: 'https://test.com',
      on: jest.fn(),
      once: jest.fn(),
      emit: jest.fn()
    }
  };
};

/**
 * Create a mock HTTP response object
 */
export const createMockResponse = (statusCode = 200, body: any = {}) => {
  return {
    ok: statusCode >= 200 && statusCode < 300,
    status: statusCode,
    statusText: getStatusText(statusCode),
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
    headers: new Map()
  };
};

/**
 * Helper function to get status text from status code
 */
function getStatusText(statusCode: number): string {
  const statusTexts: { [key: number]: string } = {
    200: 'OK',
    201: 'Created',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable'
  };
  
  return statusTexts[statusCode] || 'Unknown';
}

/**
 * Helper function to create network errors
 */
export const createNetworkError = (code: string, message: string = 'Network error') => {
  const error = new Error(message);
  (error as any).code = code;
  return error;
};

/**
 * Helper function to create fetch errors
 */
export const createFetchError = (message: string = 'Fetch error') => {
  const error = new Error(message);
  (error as any).name = 'FetchError';
  return error;
};

/**
 * Helper function to wait for a specified amount of time
 */
export const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Environment variable helper for tests
 */
export class TestEnvironment {
  private originalEnv: NodeJS.ProcessEnv;

  constructor() {
    this.originalEnv = { ...process.env };
  }

  /**
   * Set environment variables for testing
   */
  setEnvVars(vars: Record<string, string>) {
    Object.assign(process.env, vars);
  }

  /**
   * Clear specific environment variables
   */
  clearEnvVars(vars: string[]) {
    vars.forEach(key => {
      delete process.env[key];
    });
  }

  /**
   * Set up Compass API environment variables
   */
  setupCompassEnv() {
    this.setEnvVars({
      COMPASS_API_URL: 'https://compass.example.com/api',
      GCLOUD_PROJECT: 'test-project-id'
    });
  }

  /**
   * Restore original environment variables
   */
  restore() {
    process.env = this.originalEnv;
  }
}

/**
 * Mock response helper for rate limiting tests
 */
export const createRateLimitResponse = (retryAfter?: number) => {
  const response = createMockResponse(429, { error: 'Rate limited' });
  if (retryAfter) {
    response.headers.set('retry-after', retryAfter.toString());
  }
  
  // Mock the headers.get method properly
  const originalGet = response.headers.get;
  response.headers.get = jest.fn().mockImplementation((key: string) => {
    if (key === 'retry-after') {
      return retryAfter ? retryAfter.toString() : null;
    }
    return originalGet?.call(response.headers, key);
  });
  
  return response;
};