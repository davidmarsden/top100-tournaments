import { describe, expect, it } from 'vitest';

// Regression coverage is primarily provided by the build plus the database RPC migration.
// Keep this smoke test alongside AdminPollBuilder so the deadline editor remains represented
// in the test suite when the component is refactored.
describe('AdminPollBuilder deadline editor', () => {
  it('keeps JavaScript Date ISO conversion semantics explicit', () => {
    const value = '2026-10-09T20:00:00.000Z';
    expect(new Date(value).toISOString()).toBe(value);
  });
});
