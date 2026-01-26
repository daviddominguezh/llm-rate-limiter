import {
  BYTES_PER_KB,
  BYTES_PER_MB,
  getAvailableMemoryBytes,
  getAvailableMemoryMB,
  getMemoryStats,
  getUsedMemoryBytes,
  getUsedMemoryMB,
} from '@globalUtils/memoryUtils.js';

describe('memoryUtils', () => {
  describe('constants', () => {
    it('should have correct BYTES_PER_KB', () => {
      const EXPECTED_KB = 1024;
      expect(BYTES_PER_KB).toBe(EXPECTED_KB);
    });

    it('should have correct BYTES_PER_MB', () => {
      const EXPECTED_MB = 1024 * 1024;
      expect(BYTES_PER_MB).toBe(EXPECTED_MB);
    });
  });

  describe('getAvailableMemoryBytes', () => {
    it('should return a positive number', () => {
      const available = getAvailableMemoryBytes();
      expect(available).toBeGreaterThan(0);
    });

    it('should return a reasonable value (less than 100GB)', () => {
      const MAX_REASONABLE_BYTES = 100 * 1024 * 1024 * 1024;
      const available = getAvailableMemoryBytes();
      expect(available).toBeLessThan(MAX_REASONABLE_BYTES);
    });
  });

  describe('getAvailableMemoryMB', () => {
    it('should return a positive number', () => {
      const availableMB = getAvailableMemoryMB();
      expect(availableMB).toBeGreaterThan(0);
    });

    it('should return bytes divided by BYTES_PER_MB', () => {
      const bytes = getAvailableMemoryBytes();
      const mb = getAvailableMemoryMB();
      // Use precision of 1 to account for memory changes between calls
      expect(mb).toBeCloseTo(bytes / BYTES_PER_MB, 1);
    });
  });

  describe('getUsedMemoryBytes', () => {
    it('should return a positive number', () => {
      const used = getUsedMemoryBytes();
      expect(used).toBeGreaterThan(0);
    });

    it('should return a reasonable value', () => {
      const MIN_EXPECTED_BYTES = 1024;
      const used = getUsedMemoryBytes();
      expect(used).toBeGreaterThan(MIN_EXPECTED_BYTES);
    });
  });

  describe('getUsedMemoryMB', () => {
    it('should return a positive number', () => {
      const usedMB = getUsedMemoryMB();
      expect(usedMB).toBeGreaterThan(0);
    });

    it('should return bytes divided by BYTES_PER_MB', () => {
      const bytes = getUsedMemoryBytes();
      const mb = getUsedMemoryMB();
      // Use precision of 1 to account for memory changes between calls
      expect(mb).toBeCloseTo(bytes / BYTES_PER_MB, 1);
    });
  });

  describe('getMemoryStats', () => {
    it('should return object with usedMB and availableMB', () => {
      const stats = getMemoryStats();
      expect(stats).toHaveProperty('usedMB');
      expect(stats).toHaveProperty('availableMB');
    });

    it('should return positive values for both properties', () => {
      const stats = getMemoryStats();
      expect(stats.usedMB).toBeGreaterThan(0);
      expect(stats.availableMB).toBeGreaterThan(0);
    });

    it('should return consistent values with individual functions', () => {
      const stats = getMemoryStats();
      const usedMB = getUsedMemoryMB();
      const availableMB = getAvailableMemoryMB();

      // Allow for small differences due to timing
      const TOLERANCE = 10;
      expect(Math.abs(stats.usedMB - usedMB)).toBeLessThan(TOLERANCE);
      expect(Math.abs(stats.availableMB - availableMB)).toBeLessThan(TOLERANCE);
    });
  });
});
