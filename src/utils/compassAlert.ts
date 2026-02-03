import { Functions, httpsCallable } from 'firebase/functions';

export interface CompassAlertContext {
    [key: string]: any;
}

export interface CompassAlertData {
    message: string;
    timestamp?: string;
    source?: string;
    context?: CompassAlertContext;
    description?: string;
    entity?: string;
    alias?: string;
    priority?: 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
    tags?: string[];
    actions?: string[];
    extraProperties?: Record<string, any>;
}

export interface CompassAlertResponse {
    success: boolean;
    alertId?: string;
    message?: string;
}

/**
 * Sends alert messages to cloud function for processing while providing immediate local debugging
 * 
 * @param message - The alert message to send
 * @param context - Optional context object with additional alert data
 * @param functions - Firebase Functions instance (optional, used for cloud alerting)
 * @returns Promise<boolean> - true if cloud alert was sent successfully, false otherwise
 */
export async function compassAlert(
    message: string,
    context?: CompassAlertContext,
    functions?: Functions
): Promise<boolean> {
    // Immediate console.error for local debugging
    const timestamp = new Date().toISOString();
    const source = getSourceLocation();
    
    const alertData: CompassAlertData = {
        message,
        timestamp,
        source,
        context
    };

    console.error('CompassAlert:', {
        message,
        timestamp,
        source,
        context
    });

    // Asynchronously send to cloud function if Firebase Functions is available
    if (functions) {
        try {
            const sendAlert = httpsCallable<CompassAlertData, CompassAlertResponse>(
                functions, 
                'compassAlert'
            );
            
            const response = await sendAlert(alertData);
            
            if (response.data.success) {
                console.log('CompassAlert sent to cloud successfully:', response.data.alertId);
                return true;
            } else {
                console.error('CompassAlert cloud function error:', response.data.message);
                return false;
            }
        } catch (error) {
            // Fallback to console.error if cloud function fails
            console.error('CompassAlert cloud function failed, falling back to console:', error);
            return false;
        }
    }

    // If no Firebase Functions instance provided, still return true for local debugging
    return true;
}

/**
 * Gets the source location of the calling function for debugging purposes
 * 
 * @returns string - formatted source location or 'unknown' if unavailable
 */
function getSourceLocation(): string {
    try {
        const stack = new Error().stack;
        if (!stack) return 'unknown';
        
        const stackLines = stack.split('\n');
        // Skip the first 3 lines: Error, getSourceLocation, compassAlert
        const callerLine = stackLines[3];
        
        if (callerLine) {
            // Extract file path and line number from stack trace
            const match = callerLine.match(/\((.+):(\d+):(\d+)\)/) || 
                         callerLine.match(/at (.+):(\d+):(\d+)/);
            
            if (match) {
                const filePath = match[1];
                const lineNumber = match[2];
                const columnNumber = match[3];
                
                // Extract just the filename from the full path
                const fileName = filePath.split('/').pop() || filePath;
                return `${fileName}:${lineNumber}:${columnNumber}`;
            }
        }
        
        return 'unknown';
    } catch (error) {
        return 'unknown';
    }
}

/**
 * Convenience function for error alerting with automatic error context extraction
 * 
 * @param message - The alert message
 * @param error - Error object to extract context from
 * @param additionalContext - Additional context to include
 * @param functions - Firebase Functions instance (optional)
 * @returns Promise<boolean> - true if alert was sent successfully
 */
export async function compassAlertError(
    message: string,
    error: Error,
    additionalContext?: CompassAlertContext,
    functions?: Functions
): Promise<boolean> {
    const errorContext: CompassAlertContext = {
        errorName: error.name,
        errorMessage: error.message,
        errorStack: error.stack,
        ...additionalContext
    };

    return compassAlert(message, errorContext, functions);
}

/**
 * Convenience function for performance alerting
 * 
 * @param operation - The operation being measured
 * @param duration - Duration in milliseconds
 * @param threshold - Performance threshold in milliseconds
 * @param additionalContext - Additional context to include
 * @param functions - Firebase Functions instance (optional)
 * @returns Promise<boolean> - true if alert was sent successfully
 */
export async function compassAlertPerformance(
    operation: string,
    duration: number,
    threshold: number,
    additionalContext?: CompassAlertContext,
    functions?: Functions
): Promise<boolean> {
    if (duration <= threshold) {
        return true; // No alert needed
    }

    const performanceContext: CompassAlertContext = {
        operation,
        duration,
        threshold,
        exceedsThresholdBy: duration - threshold,
        ...additionalContext
    };

    return compassAlert(
        `Performance threshold exceeded for ${operation}`,
        performanceContext,
        functions
    );
}

/**
 * Enhanced function to send alerts with full Compass API support
 * 
 * @param alertData - Complete alert data object with all Compass API fields
 * @param functions - Firebase Functions instance (optional, used for cloud alerting)
 * @returns Promise<boolean> - true if cloud alert was sent successfully, false otherwise
 */
export async function compassAlertEnhanced(
    alertData: CompassAlertData,
    functions?: Functions
): Promise<boolean> {
    // Immediate console.error for local debugging
    const timestamp = alertData.timestamp || new Date().toISOString();
    const source = alertData.source || getSourceLocation();
    
    console.error(`[${timestamp}] ${alertData.message}`, {
        source,
        priority: alertData.priority || 'P3',
        entity: alertData.entity,
        context: alertData.context,
        description: alertData.description
    });
    
    // Return early if no Firebase Functions instance provided
    if (!functions) {
        return true;
    }
    
    try {
        // Prepare complete alert data
        const completeAlertData: CompassAlertData = {
            ...alertData,
            timestamp,
            source: alertData.source || source
        };
        
        const compassAlertFunction = httpsCallable(functions, 'compassAlert');
        const response = await compassAlertFunction(completeAlertData);
        
        return (response.data as CompassAlertResponse)?.success === true;
    } catch (error) {
        console.error('Failed to send Compass alert:', error);
        return false;
    }
}