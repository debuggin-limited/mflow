import { compassAlert, compassAlertError, compassAlertPerformance, CompassAlertContext } from './compassAlert';
import { Functions, httpsCallable } from 'firebase/functions';

// Mock Firebase Functions
jest.mock('firebase/functions', () => ({
    httpsCallable: jest.fn()
}));

// Mock console methods
const originalConsoleError = console.error;
const originalConsoleLog = console.log;

describe('compassAlert', () => {
    let mockConsoleError: jest.SpyInstance;
    let mockConsoleLog: jest.SpyInstance;
    let mockHttpsCallable: jest.MockedFunction<typeof httpsCallable>;
    let mockFunctions: Functions;

    beforeEach(() => {
        // Mock console methods
        mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
        
        // Mock Firebase Functions
        mockHttpsCallable = httpsCallable as jest.MockedFunction<typeof httpsCallable>;
        mockFunctions = {} as Functions;
        
        // Reset mocks
        jest.clearAllMocks();
    });

    afterEach(() => {
        // Restore console methods
        mockConsoleError.mockRestore();
        mockConsoleLog.mockRestore();
    });

    describe('compassAlert', () => {
        it('should log to console.error immediately for local debugging', async () => {
            const message = 'Test alert message';
            const context = { userId: '123', action: 'test' };

            await compassAlert(message, context);

            expect(mockConsoleError).toHaveBeenCalledWith('CompassAlert:', {
                message,
                timestamp: expect.any(String),
                source: expect.any(String),
                context
            });
        });

        it('should include timestamp in ISO format', async () => {
            const message = 'Test alert message';
            const beforeTime = new Date().toISOString();
            
            await compassAlert(message);
            
            const callArgs = mockConsoleError.mock.calls[0][1];
            const timestamp = callArgs.timestamp;
            const afterTime = new Date().toISOString();

            expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(timestamp >= beforeTime).toBe(true);
            expect(timestamp <= afterTime).toBe(true);
        });

        it('should extract source location from stack trace', async () => {
            const message = 'Test alert message';
            
            await compassAlert(message);
            
            const callArgs = mockConsoleError.mock.calls[0][1];
            const source = callArgs.source;

            expect(source).toBeDefined();
            expect(typeof source).toBe('string');
            // Source should be either 'unknown' or in format 'filename:line:column'
            expect(source === 'unknown' || /^[^:]+:\d+:\d+$/.test(source)).toBe(true);
        });

        it('should return true when no Firebase Functions instance provided', async () => {
            const message = 'Test alert message';
            
            const result = await compassAlert(message);
            
            expect(result).toBe(true);
        });

        it('should handle undefined context gracefully', async () => {
            const message = 'Test alert message';
            
            await compassAlert(message);
            
            expect(mockConsoleError).toHaveBeenCalledWith('CompassAlert:', {
                message,
                timestamp: expect.any(String),
                source: expect.any(String),
                context: undefined
            });
        });

        it('should send alert to cloud function when Firebase Functions is provided', async () => {
            const message = 'Test alert message';
            const context = { userId: '123' };
            const mockCloudFunction = jest.fn().mockResolvedValue({
                data: { success: true, alertId: 'alert-123' }
            });

            mockHttpsCallable.mockReturnValue(mockCloudFunction);

            const result = await compassAlert(message, context, mockFunctions);

            expect(mockHttpsCallable).toHaveBeenCalledWith(mockFunctions, 'compassAlert');
            expect(mockCloudFunction).toHaveBeenCalledWith({
                message,
                timestamp: expect.any(String),
                source: expect.any(String),
                context
            });
            expect(result).toBe(true);
            expect(mockConsoleLog).toHaveBeenCalledWith(
                'CompassAlert sent to cloud successfully:', 
                'alert-123'
            );
        });

        it('should handle cloud function success response', async () => {
            const message = 'Test alert message';
            const mockCloudFunction = jest.fn().mockResolvedValue({
                data: { success: true, alertId: 'alert-456' }
            });

            mockHttpsCallable.mockReturnValue(mockCloudFunction);

            const result = await compassAlert(message, undefined, mockFunctions);

            expect(result).toBe(true);
            expect(mockConsoleLog).toHaveBeenCalledWith(
                'CompassAlert sent to cloud successfully:', 
                'alert-456'
            );
        });

        it('should handle cloud function error response', async () => {
            const message = 'Test alert message';
            const mockCloudFunction = jest.fn().mockResolvedValue({
                data: { success: false, message: 'Cloud function error' }
            });

            mockHttpsCallable.mockReturnValue(mockCloudFunction);

            const result = await compassAlert(message, undefined, mockFunctions);

            expect(result).toBe(false);
            expect(mockConsoleError).toHaveBeenCalledWith(
                'CompassAlert cloud function error:', 
                'Cloud function error'
            );
        });

        it('should fallback to console.error when cloud function throws', async () => {
            const message = 'Test alert message';
            const error = new Error('Network error');
            const mockCloudFunction = jest.fn().mockRejectedValue(error);

            mockHttpsCallable.mockReturnValue(mockCloudFunction);

            const result = await compassAlert(message, undefined, mockFunctions);

            expect(result).toBe(false);
            expect(mockConsoleError).toHaveBeenCalledWith(
                'CompassAlert cloud function failed, falling back to console:', 
                error
            );
        });

        it('should handle complex context objects', async () => {
            const message = 'Test alert message';
            const context: CompassAlertContext = {
                userId: '123',
                action: 'test',
                metadata: {
                    nested: 'value',
                    array: [1, 2, 3],
                    boolean: true
                },
                timestamp: new Date().toISOString()
            };

            await compassAlert(message, context);

            expect(mockConsoleError).toHaveBeenCalledWith('CompassAlert:', {
                message,
                timestamp: expect.any(String),
                source: expect.any(String),
                context
            });
        });
    });

    describe('compassAlertError', () => {
        it('should extract error context and call compassAlert', async () => {
            const message = 'Error occurred';
            const error = new Error('Test error');
            error.name = 'TestError';
            error.stack = 'Error stack trace';

            const result = await compassAlertError(message, error);

            expect(result).toBe(true);
            expect(mockConsoleError).toHaveBeenCalledWith('CompassAlert:', {
                message,
                timestamp: expect.any(String),
                source: expect.any(String),
                context: {
                    errorName: 'TestError',
                    errorMessage: 'Test error',
                    errorStack: 'Error stack trace'
                }
            });
        });

        it('should merge additional context with error context', async () => {
            const message = 'Error occurred';
            const error = new Error('Test error');
            const additionalContext = { userId: '123', action: 'test' };

            await compassAlertError(message, error, additionalContext);

            expect(mockConsoleError).toHaveBeenCalledWith('CompassAlert:', {
                message,
                timestamp: expect.any(String),
                source: expect.any(String),
                context: {
                    errorName: 'Error',
                    errorMessage: 'Test error',
                    errorStack: expect.any(String),
                    userId: '123',
                    action: 'test'
                }
            });
        });

        it('should work with Firebase Functions instance', async () => {
            const message = 'Error occurred';
            const error = new Error('Test error');
            const mockCloudFunction = jest.fn().mockResolvedValue({
                data: { success: true, alertId: 'error-alert-123' }
            });

            mockHttpsCallable.mockReturnValue(mockCloudFunction);

            const result = await compassAlertError(message, error, undefined, mockFunctions);

            expect(result).toBe(true);
            expect(mockHttpsCallable).toHaveBeenCalledWith(mockFunctions, 'compassAlert');
            expect(mockCloudFunction).toHaveBeenCalledWith({
                message,
                timestamp: expect.any(String),
                source: expect.any(String),
                context: {
                    errorName: 'Error',
                    errorMessage: 'Test error',
                    errorStack: expect.any(String)
                }
            });
        });
    });

    describe('compassAlertPerformance', () => {
        it('should not alert when duration is within threshold', async () => {
            const operation = 'testOperation';
            const duration = 100;
            const threshold = 200;

            const result = await compassAlertPerformance(operation, duration, threshold);

            expect(result).toBe(true);
            expect(mockConsoleError).not.toHaveBeenCalled();
        });

        it('should alert when duration exceeds threshold', async () => {
            const operation = 'testOperation';
            const duration = 300;
            const threshold = 200;

            const result = await compassAlertPerformance(operation, duration, threshold);

            expect(result).toBe(true);
            expect(mockConsoleError).toHaveBeenCalledWith('CompassAlert:', {
                message: 'Performance threshold exceeded for testOperation',
                timestamp: expect.any(String),
                source: expect.any(String),
                context: {
                    operation,
                    duration,
                    threshold,
                    exceedsThresholdBy: 100
                }
            });
        });

        it('should merge additional context with performance context', async () => {
            const operation = 'testOperation';
            const duration = 300;
            const threshold = 200;
            const additionalContext = { userId: '123', component: 'TestComponent' };

            await compassAlertPerformance(operation, duration, threshold, additionalContext);

            expect(mockConsoleError).toHaveBeenCalledWith('CompassAlert:', {
                message: 'Performance threshold exceeded for testOperation',
                timestamp: expect.any(String),
                source: expect.any(String),
                context: {
                    operation,
                    duration,
                    threshold,
                    exceedsThresholdBy: 100,
                    userId: '123',
                    component: 'TestComponent'
                }
            });
        });

        it('should work with Firebase Functions instance', async () => {
            const operation = 'testOperation';
            const duration = 300;
            const threshold = 200;
            const mockCloudFunction = jest.fn().mockResolvedValue({
                data: { success: true, alertId: 'perf-alert-123' }
            });

            mockHttpsCallable.mockReturnValue(mockCloudFunction);

            const result = await compassAlertPerformance(operation, duration, threshold, undefined, mockFunctions);

            expect(result).toBe(true);
            expect(mockHttpsCallable).toHaveBeenCalledWith(mockFunctions, 'compassAlert');
            expect(mockCloudFunction).toHaveBeenCalledWith({
                message: 'Performance threshold exceeded for testOperation',
                timestamp: expect.any(String),
                source: expect.any(String),
                context: {
                    operation,
                    duration,
                    threshold,
                    exceedsThresholdBy: 100
                }
            });
        });

        it('should handle exact threshold match as no alert needed', async () => {
            const operation = 'testOperation';
            const duration = 200;
            const threshold = 200;

            const result = await compassAlertPerformance(operation, duration, threshold);

            expect(result).toBe(true);
            expect(mockConsoleError).not.toHaveBeenCalled();
        });
    });

    describe('error handling', () => {
        it('should handle stack trace extraction errors gracefully', async () => {
            // Mock Error constructor to simulate stack trace extraction failure
            const originalError = Error;
            const mockError = jest.fn().mockImplementation(() => {
                const error = new originalError();
                error.stack = undefined;
                return error;
            });
            global.Error = mockError as any;

            const message = 'Test alert message';
            
            await compassAlert(message);
            
            const callArgs = mockConsoleError.mock.calls[0][1];
            expect(callArgs.source).toBe('unknown');

            // Restore original Error constructor
            global.Error = originalError;
        });

        it('should handle malformed stack traces', async () => {
            // Mock Error constructor to simulate malformed stack trace
            const originalError = Error;
            const mockError = jest.fn().mockImplementation(() => {
                const error = new originalError();
                error.stack = 'Invalid stack trace format';
                return error;
            });
            global.Error = mockError as any;

            const message = 'Test alert message';
            
            await compassAlert(message);
            
            const callArgs = mockConsoleError.mock.calls[0][1];
            expect(callArgs.source).toBe('unknown');

            // Restore original Error constructor
            global.Error = originalError;
        });
    });
});