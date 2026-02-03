/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
*/

/*
 * IMPORTANT
 *
 * Turns out on 15th Jan 2020, Google changed the security settings where 
 * all new functions no longer have a Cloud Functions Invoker. This means
 * that all newly created functions will have their access forbidden, 
 * thus resulting in a CORS policy block.
 * 
 * Here is how you fix it, as it's not all that obvious:
 * 
 * https://cloud.google.com/functions/docs/securing/managing-access-iam#allowing_unauthenticated_function_invocation
*/

import {onCall, HttpsError} from "firebase-functions/v2/https";
import {SecretManagerServiceClient} from "@google-cloud/secret-manager";

const fetch = require("node-fetch");

// Start writing functions
// https://firebase.google.com/docs/functions/typescript
export const tokenExchange = onCall({
    cors: true // Enable CORS for all origins
}, async (request) => {
    try {
        // Validate input
        if (!request.data || !request.data.code) {
            throw new HttpsError('invalid-argument', 'Authorization code is required');
        }

        // Use URLSearchParams for form data instead of form-data library
        const body = new URLSearchParams();
        body.append("grant_type", "authorization_code");
        body.append("client_id", process.env.REACT_APP_MONZO_CLIENT_ID || "");
        body.append("client_secret", process.env.REACT_APP_MONZO_CLIENT_SECRET || "");
        body.append("redirect_uri", process.env.REACT_APP_MONZO_REDIRECT_URI || "");
        body.append("code", request.data.code);

        console.log(body)
        const response = await fetch("https://api.monzo.com/oauth2/token", {
            method: "post",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Monzo API error details:', {
                status: response.status,
                statusText: response.statusText,
                responseData: data,
                requestData: {
                    grant_type: "authorization_code",
                    client_id: process.env.REACT_APP_MONZO_CLIENT_ID,
                    client_secret: process.env.REACT_APP_MONZO_CLIENT_SECRET || "N/A",
                    redirect_uri: process.env.REACT_APP_MONZO_REDIRECT_URI,
                    code: request.data.code
                }
            });
            throw new HttpsError('internal', `Monzo API error: ${response.status} - ${JSON.stringify(data)}`);
        }

        return data;
    } catch (error) {
        console.error('Token exchange error:', error);
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', 'Failed to exchange token');
    }
});

// Initialize Secret Manager client
const secretClient = new SecretManagerServiceClient();

/**
 * Helper function to get secret from GCP Secret Manager
 */
async function getSecret(secretName: string): Promise<string> {
    try {
        const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
        if (!projectId) {
            throw new Error('Project ID not found in environment variables');
        }
        
        const [version] = await secretClient.accessSecretVersion({
            name: `projects/${projectId}/secrets/${secretName}/versions/latest`,
        });
        
        const secretValue = version.payload?.data?.toString();
        if (!secretValue) {
            throw new Error(`Secret ${secretName} is empty or not found`);
        }
        
        return secretValue;
    } catch (error) {
        console.error(`Failed to get secret ${secretName}:`, error);
        throw error;
    }
}

// Compass Alert function to forward alerts to Compass API
export const compassAlert = onCall({
    cors: true // Enable CORS for all origins
}, async (request) => {
    try {
        // Validate input
        if (!request.data) {
            throw new HttpsError('invalid-argument', 'Alert data is required');
        }

        const { 
            message, 
            context, 
            timestamp, 
            source, 
            priority,
            description,
            entity,
            alias,
            tags,
            actions,
            extraProperties
        } = request.data;

        // Validate required fields
        if (!message) {
            throw new HttpsError('invalid-argument', 'Alert message is required');
        }

        // Get Compass API URL from environment variables
        const compassApiUrl = process.env.COMPASS_API_URL;
        
        if (!compassApiUrl) {
            console.error('COMPASS_API_URL not configured');
            throw new HttpsError('failed-precondition', 'Compass API URL not configured');
        }

        // Get Atlassian credentials from Secret Manager
        let atlassianEmail: string;
        let atlassianApiKey: string;
        
        try {
            console.log('Fetching Atlassian credentials from Secret Manager...');
            [atlassianEmail, atlassianApiKey] = await Promise.all([
                getSecret('atlassian-email'),
                getSecret('atlassian-api-key')
            ]);
            console.log('Successfully retrieved Atlassian credentials');
        } catch (error) {
            console.error('Failed to retrieve Atlassian credentials from Secret Manager:', error);
            throw new HttpsError('failed-precondition', 'Failed to retrieve Atlassian credentials');
        }

        // Prepare Compass alert payload following the API specification
        const alertPayload: any = {
            message,
            description: description || message,
            source: source || 'mflow-app',
            entity: entity || 'mflow',
            priority: priority || 'P3',
            timestamp: timestamp || new Date().toISOString()
        };

        // Add optional fields if provided
        if (alias) alertPayload.alias = alias;
        if (tags && Array.isArray(tags)) alertPayload.tags = tags;
        if (actions && Array.isArray(actions)) alertPayload.actions = actions;
        
        // Always include extraProperties with MFlow context
        alertPayload.extraProperties = {
            mflowContext: context || {},
            timestamp: alertPayload.timestamp,
            ...(extraProperties && typeof extraProperties === 'object' ? extraProperties : {})
        };

        console.log('Sending alert to Compass:', {
            url: compassApiUrl,
            source: alertPayload.source,
            messageLength: message.length
        });

        // Function to make API call with retry logic
        const makeApiCall = async (retryCount = 0): Promise<any> => {
            const maxRetries = 3;
            const retryDelay = Math.pow(2, retryCount) * 1000; // Exponential backoff: 1s, 2s, 4s

            try {
                // Create basic auth header from email:api-key format
                const credentials = `${atlassianEmail}:${atlassianApiKey}`;
                const basicAuthHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;
                
                const response = await fetch(compassApiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': basicAuthHeader,
                        'User-Agent': 'mflow-compass-alert/1.0'
                    },
                    body: JSON.stringify(alertPayload),
                    timeout: 10000 // 10 second timeout
                });

                const responseData = await response.json();

                if (!response.ok) {
                    console.error('Compass API error details:', {
                        status: response.status,
                        statusText: response.statusText,
                        responseData,
                        retryCount
                    });

                    // Check if we should retry based on status code
                    if (response.status >= 500 && retryCount < maxRetries) {
                        console.log(`Retrying after ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries + 1})`);
                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                        return makeApiCall(retryCount + 1);
                    }

                    // Handle rate limiting (429)
                    if (response.status === 429) {
                        const retryAfter = response.headers.get('retry-after');
                        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : retryDelay;
                        
                        if (retryCount < maxRetries) {
                            console.log(`Rate limited, retrying after ${waitTime}ms (attempt ${retryCount + 1}/${maxRetries + 1})`);
                            await new Promise(resolve => setTimeout(resolve, waitTime));
                            return makeApiCall(retryCount + 1);
                        }
                    }

                    throw new HttpsError('internal', `Compass API error: ${response.status} - ${JSON.stringify(responseData)}`);
                }

                console.log('Alert sent successfully to Compass:', {
                    status: response.status,
                    alertId: responseData.id || 'unknown'
                });

                return responseData;
            } catch (error: any) {
                console.error('API call failed:', error);
                
                // Retry on network errors
                if (retryCount < maxRetries && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.name === 'FetchError')) {
                    console.log(`Network error, retrying after ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries + 1})`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    return makeApiCall(retryCount + 1);
                }
                
                throw error;
            }
        };

        // Make the API call with retry logic
        const result = await makeApiCall();

        return {
            success: true,
            alertId: result.id || null,
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        console.error('Compass alert error:', error);
        
        if (error instanceof HttpsError) {
            throw error;
        }
        
        throw new HttpsError('internal', 'Failed to send alert to Compass');
    }
});
