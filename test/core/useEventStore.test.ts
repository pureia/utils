import { useEventStore } from '@purea/utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 定义测试用的事件类型
interface TestEvents {
  'user:login': { userId: string; name: string };
  'cart:update': { count: number };
  'message:send': string;
}

describe('useEventStore', () => {
  const eventStore = useEventStore<TestEvents>();

  afterEach(() => {
    eventStore.clear();
  });

  describe('on/emit', () => {
    it('should subscribe and emit events', () => {
      const handler = vi.fn();

      eventStore.on('user:login', handler);
      eventStore.emit('user:login', { userId: '1', name: 'John' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ userId: '1', name: 'John' });
    });

    it('should support multiple handlers for same event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      eventStore.on('user:login', handler1);
      eventStore.on('user:login', handler2);
      eventStore.emit('user:login', { userId: '1', name: 'John' });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should return unsubscribe function', () => {
      const handler = vi.fn();

      const unsubscribe = eventStore.on('user:login', handler);
      unsubscribe();
      eventStore.emit('user:login', { userId: '1', name: 'John' });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('once', () => {
    it('should trigger handler only once', () => {
      const handler = vi.fn();

      eventStore.once('user:login', handler);
      eventStore.emit('user:login', { userId: '1', name: 'John' });
      eventStore.emit('user:login', { userId: '2', name: 'Jane' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ userId: '1', name: 'John' });
    });

    it('should return unsubscribe function', () => {
      const handler = vi.fn();

      const unsubscribe = eventStore.once('user:login', handler);
      unsubscribe();
      eventStore.emit('user:login', { userId: '1', name: 'John' });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('should remove specific handler via unsubscribe function', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const unsubscribe1 = eventStore.on('user:login', handler1);
      eventStore.on('user:login', handler2);
      unsubscribe1();
      eventStore.emit('user:login', { userId: '1', name: 'John' });

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('should catch errors in handlers and continue', () => {
      const errorHandler = vi.fn(() => {
        throw new Error('test error');
      });
      const normalHandler = vi.fn();

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      eventStore.on('message:send', errorHandler);
      eventStore.on('message:send', normalHandler);
      eventStore.emit('message:send', 'hello');

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(normalHandler).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('has/get/set/delete/clear', () => {
    it('should check if key exists', () => {
      expect(eventStore.has('user:login')).toBe(false);
      eventStore.on('user:login', () => {});
      expect(eventStore.has('user:login')).toBe(true);
    });

    it('should get stored value', () => {
      expect(eventStore.get('user:login')).toBeNull();

      eventStore.on('user:login', () => {});
      const value = eventStore.get('user:login');

      expect(value).toBeInstanceOf(Set);
    });

    it('should set raw value', () => {
      const handlers = new Set<(result: { count: number }) => void>();

      eventStore.set('cart:update', handlers);
      expect(eventStore.has('cart:update')).toBe(true);
      expect(eventStore.get('cart:update')).toBe(handlers);
    });

    it('should clear all entries', () => {
      eventStore.on('user:login', () => {});
      eventStore.on('cart:update', () => {});
      eventStore.clear();

      expect(eventStore.has('user:login')).toBe(false);
      expect(eventStore.has('cart:update')).toBe(false);
    });

    it('should delete specific key', () => {
      eventStore.on('user:login', () => {});
      eventStore.delete('user:login');

      expect(eventStore.has('user:login')).toBe(false);
    });
  });

  describe('type safety', () => {
    it('should provide type-safe event data', () => {
      const handler = vi.fn<(result: { count: number }) => void>();

      eventStore.on('cart:update', handler);
      eventStore.emit('cart:update', { count: 5 });

      expect(handler).toHaveBeenCalledWith({ count: 5 });
    });
  });

  describe('edge cases', () => {
    it('should handle emit with no subscribers gracefully', () => {
      expect(() => eventStore.emit('user:login', { userId: '1', name: 'John' })).not.toThrow();
    });

    it('should handle multiple once subscriptions independently', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      eventStore.once('user:login', handler1);
      eventStore.once('user:login', handler2);
      eventStore.emit('user:login', { userId: '1', name: 'John' });
      eventStore.emit('user:login', { userId: '2', name: 'Jane' });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should handle off for non-existent handler gracefully', () => {
      const handler = vi.fn();

      eventStore.on('user:login', () => {});
      expect(() => {
        const unsubscribe = eventStore.on('user:login', handler);
        unsubscribe();
        unsubscribe();
      }).not.toThrow();
    });

    it('should handle deleting non-existent key gracefully', () => {
      expect(() => eventStore.delete('user:login')).not.toThrow();
      expect(eventStore.has('user:login')).toBe(false);
    });

    it('should not duplicate same handler for same event', () => {
      const handler = vi.fn();

      eventStore.on('user:login', handler);
      eventStore.on('user:login', handler);
      eventStore.emit('user:login', { userId: '1', name: 'John' });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('keys', () => {
    it('should return all registered event keys', () => {
      expect(eventStore.keys()).toEqual([]);

      eventStore.on('user:login', () => {});
      eventStore.on('cart:update', () => {});
      expect(eventStore.keys()).toEqual(['user:login', 'cart:update']);

      eventStore.delete('user:login');
      expect(eventStore.keys()).toEqual(['cart:update']);
    });
  });

  describe('multiple instances', () => {
    it('should create independent event stores', () => {
      const store1 = useEventStore<TestEvents>();
      const store2 = useEventStore<TestEvents>();

      const handler1 = vi.fn();
      const handler2 = vi.fn();

      store1.on('user:login', handler1);
      store2.on('user:login', handler2);

      store1.emit('user:login', { userId: '1', name: 'John' });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).not.toHaveBeenCalled();

      store2.emit('user:login', { userId: '2', name: 'Jane' });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });
  });
});
