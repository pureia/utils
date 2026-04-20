import { describe, expect, it, vi } from 'vitest';
import { useEventStore } from '@purea/utils/core';

type TestEvents = {
  'user:login': { userId: string; name: string };
  'cart:update': { count: number };
  'message:send': string;
};

describe('useEventStore', () => {
  describe('on/emit', () => {
    it('should subscribe and emit events', () => {
      const store = useEventStore<TestEvents>();
      const handler = vi.fn();

      store.on('user:login', handler);
      store.emit('user:login', { userId: '1', name: 'John' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ userId: '1', name: 'John' });
    });

    it('should support multiple handlers for same event', () => {
      const store = useEventStore<TestEvents>();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      store.on('user:login', handler1);
      store.on('user:login', handler2);
      store.emit('user:login', { userId: '1', name: 'John' });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should return unsubscribe function', () => {
      const store = useEventStore<TestEvents>();
      const handler = vi.fn();

      const unsubscribe = store.on('user:login', handler);
      unsubscribe();
      store.emit('user:login', { userId: '1', name: 'John' });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('once', () => {
    it('should trigger handler only once', () => {
      const store = useEventStore<TestEvents>();
      const handler = vi.fn();

      store.once('user:login', handler);
      store.emit('user:login', { userId: '1', name: 'John' });
      store.emit('user:login', { userId: '2', name: 'Jane' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ userId: '1', name: 'John' });
    });

    it('should return unsubscribe function', () => {
      const store = useEventStore<TestEvents>();
      const handler = vi.fn();

      const unsubscribe = store.once('user:login', handler);
      unsubscribe();
      store.emit('user:login', { userId: '1', name: 'John' });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('should remove specific handler via unsubscribe function', () => {
      const store = useEventStore<TestEvents>();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const unsubscribe1 = store.on('user:login', handler1);
      store.on('user:login', handler2);
      unsubscribe1();
      store.emit('user:login', { userId: '1', name: 'John' });

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('should catch errors in handlers and continue', () => {
      const store = useEventStore<TestEvents>();
      const errorHandler = vi.fn(() => {
        throw new Error('test error');
      });
      const normalHandler = vi.fn();

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      store.on('message:send', errorHandler);
      store.on('message:send', normalHandler);
      store.emit('message:send', 'hello');

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(normalHandler).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('has/get/set/delete/clear', () => {
    it('should check if key exists', () => {
      const store = useEventStore<TestEvents>();

      expect(store.has('user:login')).toBe(false);
      store.on('user:login', () => {});
      expect(store.has('user:login')).toBe(true);
    });

    it('should get stored value', () => {
      const store = useEventStore<TestEvents>();

      expect(store.get('user:login')).toBeNull();

      store.on('user:login', () => {});
      const value = store.get('user:login');

      expect(value).toBeInstanceOf(Set);
    });

    it('should set raw value', () => {
      const store = useEventStore<TestEvents>();
      const handlers = new Set<(result: { count: number }) => void>();

      store.set('cart:update', handlers);
      expect(store.has('cart:update')).toBe(true);
      expect(store.get('cart:update')).toBe(handlers);
    });

    it('should clear all entries', () => {
      const store = useEventStore<TestEvents>();

      store.on('user:login', () => {});
      store.on('cart:update', () => {});
      store.clear();

      expect(store.has('user:login')).toBe(false);
      expect(store.has('cart:update')).toBe(false);
    });

    it('should delete specific key', () => {
      const store = useEventStore<TestEvents>();

      store.on('user:login', () => {});
      store.delete('user:login');

      expect(store.has('user:login')).toBe(false);
    });
  });

  describe('type safety', () => {
    it('should provide type-safe event data', () => {
      const store = useEventStore<TestEvents>();
      const handler = vi.fn<(result: { count: number }) => void>();

      store.on('cart:update', handler);
      store.emit('cart:update', { count: 5 });

      expect(handler).toHaveBeenCalledWith({ count: 5 });
    });
  });

  describe('edge cases', () => {
    it('should handle emit with no subscribers gracefully', () => {
      const store = useEventStore<TestEvents>();

      expect(() => store.emit('user:login', { userId: '1', name: 'John' })).not.toThrow();
    });

    it('should handle multiple once subscriptions independently', () => {
      const store = useEventStore<TestEvents>();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      store.once('user:login', handler1);
      store.once('user:login', handler2);
      store.emit('user:login', { userId: '1', name: 'John' });
      store.emit('user:login', { userId: '2', name: 'Jane' });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should handle off for non-existent handler gracefully', () => {
      const store = useEventStore<TestEvents>();
      const handler = vi.fn();

      store.on('user:login', () => {});
      // 直接调用 off 移除一个未注册的 handler
      expect(() => {
        const unsubscribe = store.on('user:login', handler);
        unsubscribe();
        unsubscribe(); // 重复调用 unsubscribe
      }).not.toThrow();
    });
  });
});
