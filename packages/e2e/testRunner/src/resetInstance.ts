/**
 * Utility to reset a server instance via its debug endpoint.
 */
import { request } from 'node:http';

const HTTP_OK = 200;

/** Valid config preset names */
export type ConfigPresetName =
  | 'default'
  | 'slotCalculation'
  | 'fixedRatio'
  | 'flexibleRatio'
  | 'instanceScaling';

/** Options for resetting an instance */
export interface ResetOptions {
  /** Whether to clean Redis keys (default: true). Set to false when multiple instances share Redis. */
  cleanRedis?: boolean;
  /** Configuration preset to use after reset */
  configPreset?: ConfigPresetName;
}

/** Result of a reset operation */
export interface ResetResult {
  success: boolean;
  keysDeleted: number;
  newInstanceId: string;
  error?: string;
}

/**
 * Reset a server instance by calling POST /api/debug/reset.
 * @param baseUrl - The base URL of the server instance
 * @param options - Reset options (cleanRedis defaults to true)
 */
export const resetInstance = async (baseUrl: string, options: ResetOptions = {}): Promise<ResetResult> => {
  const { cleanRedis = true, configPreset } = options;
  const requestBody: { cleanRedis: boolean; configPreset?: ConfigPresetName } = { cleanRedis };
  if (configPreset !== undefined) {
    requestBody.configPreset = configPreset;
  }
  const body = JSON.stringify(requestBody);

  return new Promise((resolve) => {
    const urlObj = new URL(`${baseUrl}/api/debug/reset`);

    const req = request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on('end', () => {
          if (res.statusCode === HTTP_OK) {
            try {
              const data = JSON.parse(body) as ResetResult;
              resolve({
                success: true,
                keysDeleted: data.keysDeleted,
                newInstanceId: data.newInstanceId,
              });
            } catch {
              resolve({
                success: false,
                keysDeleted: 0,
                newInstanceId: '',
                error: 'Failed to parse response',
              });
            }
          } else {
            resolve({
              success: false,
              keysDeleted: 0,
              newInstanceId: '',
              error: `HTTP ${res.statusCode}: ${body}`,
            });
          }
        });
      }
    );

    req.on('error', (error) => {
      resolve({
        success: false,
        keysDeleted: 0,
        newInstanceId: '',
        error: error.message,
      });
    });

    req.end(body);
  });
};
