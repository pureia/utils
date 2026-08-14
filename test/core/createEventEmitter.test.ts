import { createEventEmitter } from '@purea/utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 定义测试用的事件类型
interface TestEvents {
  'user:login': { userId: string; name: string };
  'cart:update': { count: number };
  'message:send': string;
}

describe('createEventEmitter', () => {
  const eventEmitter = createEventEmitter<TestEvents>();

  afterEach(() => {
    eventEmitter.clear();
  });

  describe('on/emit', () => {
    it('should subscribe and emit events', () => {
      const handler = vi.fn();

      eventEmitter.on('user:login', handler);
      eventEmitter.emit('user:login', { userId: '1', name: 'John' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ userId: '1', name: 'John' });
    });

    it('should support multiple handlers for same event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      eventEmitter.on('user:login', handler1);
      eventEmitter.on('user:login', handler2);
      eventEmitter.emit('user:login', { userId: '1', name: 'John' });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should return unsubscribe function', () => {
      const handler = vi.fn();

      const unsubscribe = eventEmitter.on('user:login', handler);
      unsubscribe();
      eventEmitter.emit('user:login', { userId: '1', name: 'John' });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('once', () => {
    it('should trigger handler only once', () => {
      const handler = vi.fn();

      eventEmitter.once('user:login', handler);
      eventEmitter.emit('user:login', { userId: '1', name: 'John' });
      eventEmitter.emit('user:login', { userId: '2', name: 'Jane' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ userId: '1', name: 'John' });
    });

    it('should return unsubscribe function', () => {
      const handler = vi.fn();

      const unsubscribe = eventEmitter.once('user:login', handler);
      unsubscribe();
      eventEmitter.emit('user:login', { userId: '1', name: 'John' });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('should remove specific handler via unsubscribe function', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const unsubscribe1 = eventEmitter.on('user:login', handler1);
      eventEmitter.on('user:login', handler2);
      unsubscribe1();
      eventEmitter.emit('user:login', { userId: '1', name: 'John' });

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

      eventEmitter.on('message:send', errorHandler);
      eventEmitter.on('message:send', normalHandler);
      eventEmitter.emit('message:send', 'hello');

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(normalHandler).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('has/delete/clear', () => {
    it('should check if key exists', () => {
      expect(eventEmitter.has('user:login')).toBe(false);
      eventEmitter.on('user:login', () => {});
      expect(eventEmitter.has('user:login')).toBe(true);
    });

    it('should clear all entries', () => {
      eventEmitter.on('user:login', () => {});
      eventEmitter.on('cart:update', () => {});
      eventEmitter.clear();

      expect(eventEmitter.has('user:login')).toBe(false);
      expect(eventEmitter.has('cart:update')).toBe(false);
    });

    it('should delete specific key', () => {
      eventEmitter.on('user:login', () => {});
      eventEmitter.delete('user:login');

      expect(eventEmitter.has('user:login')).toBe(false);
    });
  });

  describe('type safety', () => {
    it('should provide type-safe event data', () => {
      const handler = vi.fn<(result: { count: number }) => void>();

      eventEmitter.on('cart:update', handler);
      eventEmitter.emit('cart:update', { count: 5 });

      expect(handler).toHaveBeenCalledWith({ count: 5 });
    });
  });

  describe('edge cases', () => {
    it('should handle emit with no subscribers gracefully', () => {
      expect(() => eventEmitter.emit('user:login', { userId: '1', name: 'John' })).not.toThrow();
    });

    it('should handle multiple once subscriptions independently', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      eventEmitter.once('user:login', handler1);
      eventEmitter.once('user:login', handler2);
      eventEmitter.emit('user:login', { userId: '1', name: 'John' });
      eventEmitter.emit('user:login', { userId: '2', name: 'Jane' });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should handle off for non-existent handler gracefully', () => {
      const handler = vi.fn();

      eventEmitter.on('user:login', () => {});
      expect(() => {
        const unsubscribe = eventEmitter.on('user:login', handler);
        unsubscribe();
        unsubscribe();
      }).not.toThrow();
    });

    it('should handle deleting non-existent key gracefully', () => {
      expect(() => eventEmitter.delete('user:login')).not.toThrow();
      expect(eventEmitter.has('user:login')).toBe(false);
    });

    it('should not duplicate same handler for same event', () => {
      const handler = vi.fn();

      eventEmitter.on('user:login', handler);
      eventEmitter.on('user:login', handler);
      eventEmitter.emit('user:login', { userId: '1', name: 'John' });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('keys', () => {
    it('should return all registered event keys', () => {
      const keys = eventEmitter.keys();
      expect([...keys]).toEqual([]);

      eventEmitter.on('user:login', () => {});
      eventEmitter.on('cart:update', () => {});
      expect([...eventEmitter.keys()]).toEqual(['user:login', 'cart:update']);

      eventEmitter.delete('user:login');
      expect([...eventEmitter.keys()]).toEqual(['cart:update']);
    });
  });

  describe('multiple instances', () => {
    it('should create independent event emitters', () => {
      const emitter1 = createEventEmitter<TestEvents>();
      const emitter2 = createEventEmitter<TestEvents>();

      const handler1 = vi.fn();
      const handler2 = vi.fn();

      emitter1.on('user:login', handler1);
      emitter2.on('user:login', handler2);

      emitter1.emit('user:login', { userId: '1', name: 'John' });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).not.toHaveBeenCalled();

      emitter2.emit('user:login', { userId: '2', name: 'Jane' });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });
  });

  describe('off with an explicit handler reference', () => {
    it('should remove the specified handler without affecting others on the same key', () => {
      const emitter = createEventEmitter<TestEvents>();
      const h1 = vi.fn();
      const h2 = vi.fn();
      emitter.on('user:login', h1);
      emitter.on('user:login', h2);

      emitter.off('user:login', h1);
      emitter.emit('user:login', { userId: '1', name: 'John' });

      expect(h1).not.toHaveBeenCalled();
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it('should clear the key when the last handler is removed', () => {
      const emitter = createEventEmitter<TestEvents>();
      const h1 = vi.fn();
      emitter.on('user:login', h1);

      emitter.off('user:login', h1);

      expect(emitter.has('user:login')).toBe(false);
      expect(() => emitter.emit('user:login', { userId: '1', name: 'John' })).not.toThrow();
    });

    it('should be a silent no-op for unknown key or handler', () => {
      const emitter = createEventEmitter<TestEvents>();
      const h1 = vi.fn();
      emitter.on('user:login', h1);

      expect(() => emitter.off('cart:update', h1)).not.toThrow();
      expect(() => emitter.off('user:login', () => {})).not.toThrow();
      expect(emitter.has('user:login')).toBe(true);
    });
  });
});
