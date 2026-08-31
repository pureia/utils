import { describe, expect, it } from 'vitest';
import {
  createAsyncDedupe,
  createCancelable,
  createEventEmitter,
  debounce,
  stableStringify,
} from '@purea/utils';

describe('包根入口导出', () => {
  it('核心工具均可从根入口解析', () => {
    expect(typeof createCancelable).toBe('function');
    expect(typeof createAsyncDedupe).toBe('function');
    expect(typeof createEventEmitter).toBe('function');
    expect(typeof debounce).toBe('function');
    expect(typeof stableStringify).toBe('function');
  });
});
