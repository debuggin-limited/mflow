# Firebase Functions

This directory contains Firebase Cloud Functions for the MFlow application.

## Functions

### `tokenExchange`
Handles OAuth token exchange with the Monzo API for user authentication.

### `compassAlert`
Forwards application alerts to the Compass API for monitoring and alerting.

## Development

### Prerequisites
- Node.js 18 or higher
- Firebase CLI
- Environment variables configured (see below)

### Environment Variables
The following environment variables are required:

#### For Monzo OAuth:
- `REACT_APP_MONZO_CLIENT_ID`: Monzo OAuth client ID
- `REACT_APP_MONZO_CLIENT_SECRET`: Monzo OAuth client secret
- `REACT_APP_MONZO_REDIRECT_URI`: OAuth redirect URI

#### For Compass Alerts:
- `COMPASS_API_URL`: Compass API endpoint URL
- `COMPASS_API_KEY`: Compass API authentication key

### Available Scripts

#### Build and Deploy
```bash
npm run build          # Compile TypeScript to JavaScript
npm run build:watch    # Compile TypeScript in watch mode
npm run deploy         # Deploy functions to Firebase
```

#### Development
```bash
npm run serve          # Start Firebase emulators
npm run shell          # Start Firebase Functions shell
npm run start          # Alias for shell
```

#### Testing
```bash
npm test               # Run all tests
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Run tests with coverage report
```

#### Linting
```bash
npm run lint           # Run ESLint
```

#### Logs
```bash
npm run logs           # View Firebase Functions logs
```

## Testing

### Test Framework
- **Jest** with TypeScript support via `ts-jest`
- **Firebase Functions Test** for Cloud Functions testing
- **Mock-based testing** for external dependencies

### Test Structure
- `/src/index.test.ts` - Main test file for all functions
- `/src/compassAlert.test.ts` - Focused tests for compassAlert function
- `/src/test-setup.ts` - Test utilities and helpers
- `jest.config.js` - Jest configuration

### Test Coverage
Tests include comprehensive coverage of:
- **Input validation** - Required fields, data types
- **Environment configuration** - Missing/invalid environment variables
- **API success scenarios** - Various response formats
- **Error handling** - Client errors, server errors, network failures
- **Retry logic** - Exponential backoff, rate limiting, network timeouts
- **Payload structure** - Default values, custom values
- **Logging** - Error details, retry attempts

### Running Tests
```bash
# Run all tests
npm test

# Run tests in watch mode (re-run on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run specific test file
npm test -- --testNamePattern="compassAlert"

# Run tests with verbose output
npm test -- --verbose
```

### Test Environment
Tests use mocked external dependencies:
- `node-fetch` is mocked for HTTP requests
- Console methods are mocked to avoid noise
- Environment variables are controlled via `TestEnvironment` helper
- Firebase Admin SDK is initialized in test setup

### Writing Tests
When adding new tests:
1. Import test utilities from `test-setup.ts`
2. Use `createMockRequest()` and `createMockResponse()` helpers
3. Set up/tear down test environment properly
4. Mock external dependencies appropriately
5. Test both success and failure scenarios

Example test structure:
```typescript
import { setupTest, teardownTest, createMockRequest, TestEnvironment } from './test-setup';

describe('My Function', () => {
  let testEnv: TestEnvironment;

  beforeEach(() => {
    setupTest();
    testEnv = new TestEnvironment();
    testEnv.setupCompassEnv();
  });

  afterEach(() => {
    teardownTest();
    testEnv.restore();
  });

  it('should handle valid input', async () => {
    const req = createMockRequest({ message: 'test' });
    const result = await myFunction(req);
    expect(result).toBeDefined();
  });
});
```

## Deployment

### Prerequisites
1. Firebase project configured
2. Environment variables set in Firebase Functions config
3. Proper IAM permissions for Cloud Functions Invoker

### Deploy Functions
```bash
# Deploy all functions
npm run deploy

# Deploy specific function
firebase deploy --only functions:compassAlert
```

### Security Notes
- All functions have CORS enabled
- New functions require Cloud Functions Invoker permission
- Environment variables should be set via Firebase Functions config
- API keys should be stored securely and rotated regularly

## Architecture

### compassAlert Function
- **Input**: Alert message, optional context, timestamp, source
- **Processing**: Validates input, configures API call, implements retry logic
- **Output**: Success/failure response with alert ID
- **Error Handling**: Comprehensive retry logic with exponential backoff
- **Logging**: Structured logging for debugging and monitoring

### Retry Logic
- **Server errors (5xx)**: Retry up to 3 times with exponential backoff
- **Rate limiting (429)**: Respect retry-after header or use exponential backoff
- **Network errors**: Retry on timeout, connection reset, fetch errors
- **Client errors (4xx)**: No retry, immediate failure
- **Backoff timing**: 1s, 2s, 4s intervals

### Error Handling
- Input validation with `HttpsError` responses
- Environment configuration validation
- Comprehensive API error logging
- Graceful degradation for non-critical failures

## Monitoring

### Logs
- Function execution logs via `firebase functions:log`
- Structured error logging for debugging
- Performance metrics and retry attempts
- API response details for troubleshooting

### Alerts
- Failed function executions
- High error rates
- Performance degradation
- External API failures

## Contributing

When making changes:
1. Update tests for new functionality
2. Ensure all tests pass: `npm test`
3. Check TypeScript compilation: `npm run build`
4. Run linting: `npm run lint`
5. Test with emulators: `npm run serve`
6. Update documentation as needed