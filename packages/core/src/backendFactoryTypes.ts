/**
 * Type definitions for distributed backend factories.
 *
 * Factories allow backends to receive rate limiter config without user duplication.
 * The factory pattern enables a clean API where models and resourceEstimationsPerJob are
 * configured once in the rate limiter, and the backend receives them automatically.
 */
import type { ResourceEstimationsPerJob } from './jobTypeTypes.js';
import type { BackendConfig, ModelsConfig } from './multiModelTypes.js';

// =============================================================================
// Backend Factory Types
// =============================================================================

/**
 * Configuration passed to backend factory during initialization.
 * Contains all model and job type configuration from the rate limiter.
 */
export interface BackendFactoryInitConfig {
  /** Map of model ID to its rate limit configuration */
  models: ModelsConfig;
  /** Job type configurations with per-type resource estimates and capacity ratios */
  resourceEstimationsPerJob?: ResourceEstimationsPerJob;
  /** Model escalation priority order */
  escalationOrder?: readonly string[];
}

/**
 * Backend instance returned by factory initialization.
 * Must provide getBackendConfig() to get the BackendConfig.
 */
export interface BackendFactoryInstance {
  /** Get the backend config to pass to the rate limiter internals */
  getBackendConfig: () => BackendConfig;
  /** Stop the backend (cleanup intervals, disconnect, etc.) */
  stop: () => Promise<void>;
}

/**
 * Factory interface for distributed backends.
 * Allows backends to receive rate limiter config without user duplication.
 *
 * When a backend factory is provided to the rate limiter:
 * 1. Rate limiter calls factory.initialize() with its config during start()
 * 2. Factory creates the actual backend using models/resourceEstimationsPerJob from config
 * 3. Rate limiter uses the initialized backend's getBackendConfig() for operations
 */
export interface DistributedBackendFactory {
  /**
   * Initialize the backend with rate limiter configuration.
   * Called automatically by the rate limiter during start().
   */
  initialize: (config: BackendFactoryInitConfig) => Promise<BackendFactoryInstance>;

  /**
   * Check if backend has been initialized.
   */
  isInitialized: () => boolean;

  /**
   * Get the initialized backend instance.
   * Throws if not yet initialized.
   */
  getInstance: () => BackendFactoryInstance;
}

export const isDistributedBackendFactory = (backend: unknown): backend is DistributedBackendFactory => {
  if (backend === null || typeof backend !== 'object') return false;
  if (!('initialize' in backend)) return false;
  const { initialize } = backend as { initialize: unknown };
  return typeof initialize === 'function';
};
