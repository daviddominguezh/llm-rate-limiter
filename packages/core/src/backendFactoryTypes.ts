/**
 * Type definitions for distributed backend factories.
 *
 * Factories allow backends to receive rate limiter config without user duplication.
 * The factory pattern enables a clean API where models and resourcesPerJob are
 * configured once in the rate limiter, and the backend receives them automatically.
 */
import type { ResourcesPerJob } from './jobTypeTypes.js';
import type { DistributedBackendConfig, ModelsConfig } from './multiModelTypes.js';

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
  resourcesPerJob?: ResourcesPerJob;
  /** Model priority order */
  order?: readonly string[];
}

/**
 * Backend instance returned by factory initialization.
 * Must provide getBackendConfig() to get the DistributedBackendConfig.
 */
export interface BackendFactoryInstance {
  /** Get the backend config to pass to the rate limiter internals */
  getBackendConfig: () => DistributedBackendConfig;
  /** Stop the backend (cleanup intervals, disconnect, etc.) */
  stop: () => Promise<void>;
}

/**
 * Factory interface for distributed backends (V2).
 * Allows backends to receive rate limiter config without user duplication.
 *
 * When a backend factory is provided to the rate limiter:
 * 1. Rate limiter calls factory.initialize() with its config during start()
 * 2. Factory creates the actual backend using models/resourcesPerJob from config
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

/**
 * Type guard for checking if a backend is a factory.
 * Checks for presence of 'initialize' method which only exists on factories.
 */
/** Helper type for type guard */
interface HasInitialize {
  initialize: unknown;
}

export const isDistributedBackendFactory = (backend: unknown): backend is DistributedBackendFactory => {
  if (backend === null || typeof backend !== 'object') {
    return false;
  }
  if (!('initialize' in backend)) {
    return false;
  }
  const { initialize } = backend as HasInitialize;
  return typeof initialize === 'function';
};
