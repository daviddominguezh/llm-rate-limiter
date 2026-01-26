/**
 * Memory Utilities
 *
 * Provides accurate memory availability measurement that works correctly in:
 * - Production (Docker containers with cgroup memory limits)
 * - Development with --max-old-space-size flag
 * - Development without memory limits
 *
 * IMPORTANT: This is the ONLY method that should be used to check available memory.
 * Do NOT use os.freemem(), os.totalmem(), or raw process.memoryUsage() for
 * determining available heap memory - they don't account for V8 heap limits.
 */
import v8 from 'node:v8';

/** Bytes in a kilobyte */
export const BYTES_PER_KB = 1024;

/** Bytes in a megabyte */
export const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB;

let devHeapLimitBytes: number | null = null;
if (process.env.NODE_ENV !== 'production') {
  /**
   * Parse --max-old-space-size from NODE_OPTIONS for dev mode.
   * Returns the limit in bytes, or null if not set or in production.
   */
  const nodeOptions = process.env.NODE_OPTIONS ?? '';
  const match = /--max-old-space-size=(?<size>\d+)/v.exec(nodeOptions);
  if (match?.groups?.size !== undefined) devHeapLimitBytes = parseInt(match.groups.size, 10) * BYTES_PER_MB;
}

/**
 * Get the available heap memory in bytes.
 *
 * This is the correct way to measure available memory that approaches 0 before OOM:
 * - In production (Docker): uses V8's total_available_size which respects cgroup limits
 * - In dev with --max-old-space-size: calculates (limit - used) for accurate measurement
 * - In dev without limits: uses V8's total_available_size
 *
 * @returns Available heap memory in bytes
 */
export const getAvailableMemoryBytes = (): number => {
  const { total_available_size: available, used_heap_size: used } = v8.getHeapStatistics();

  // In dev with --max-old-space-size, calculate remaining from configured limit
  // In production, use V8's total_available_size which works correctly in Docker
  if (devHeapLimitBytes !== null) return devHeapLimitBytes - used;
  return available;
};

/**
 * Get the available heap memory in kilobytes.
 *
 * @returns Available heap memory in KB
 */
export const getAvailableMemoryKB = (): number => getAvailableMemoryBytes() / BYTES_PER_KB;

/**
 * Get the available heap memory in megabytes.
 *
 * @returns Available heap memory in MB
 */
export const getAvailableMemoryMB = (): number => getAvailableMemoryBytes() / BYTES_PER_MB;

/**
 * Get the used heap memory in bytes.
 *
 * @returns Used heap memory in bytes
 */
export const getUsedMemoryBytes = (): number => {
  const { used_heap_size: used } = v8.getHeapStatistics();
  return used;
};

/**
 * Get the used heap memory in megabytes.
 *
 * @returns Used heap memory in MB
 */
export const getUsedMemoryMB = (): number => getUsedMemoryBytes() / BYTES_PER_MB;

/**
 * Get comprehensive memory statistics.
 *
 * @returns Object with used and available memory in MB
 */
export const getMemoryStats = (): {
  usedMB: number;
  availableMB: number;
} => ({
  usedMB: getUsedMemoryMB(),
  availableMB: getAvailableMemoryMB(),
});
