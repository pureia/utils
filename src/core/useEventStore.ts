type Handler<T> = (result: T) => void;

type StoreValue<T> = T | Set<Handler<T>>;


const useEventStore = <Stores extends Record<string, unknown>>() => {
  type StoreKey = keyof Stores;

  const all = new Map<StoreKey, StoreValue<Stores[StoreKey]>>();

  const hasItem = <K extends StoreKey>(key: K) => all.has(key);

  const setItem = (key: StoreKey, value: StoreValue<Stores[StoreKey]>) => { all.set(key, value); };

  const getItem = <K extends StoreKey>(key: K) => (all.get(key) ?? null) as StoreValue<Stores[K]> | null;

  const removeItem = <K extends StoreKey>(key: K) => { all.delete(key); };

  const clear = () => { all.clear(); };

  const off = <K extends StoreKey, R extends Stores[K]>(key: K, handler: Handler<R>) => {
    const handlers = getItem(key) as Set<Handler<R>> | null;
    handlers?.delete(handler);
    handlers?.size === 0 && removeItem(key);
  };

  const on = <K extends StoreKey, R extends Stores[K]>(key: K, handler: Handler<R>) => {
    !hasItem(key) && setItem(key, new Set());
    (getItem(key) as Set<Handler<R>> | null)?.add(handler);
    return () => off(key, handler);
  };

  const once = <K extends StoreKey, R extends Stores[K]>(key: K, handler: Handler<R>) => {
    const onceHandler = (result: R) => {
      off(key, onceHandler);
      handler(result);
    };
    return on(key, onceHandler);
  };

  const emit = <K extends StoreKey, R extends Stores[K]>(key: K, result: R) => {
    const handlers = getItem(key) as Set<Handler<R>> | null;
    handlers?.forEach(handler => {
      try {
        handler(result);
      } catch (error) {
        console.error(`EventStore error in "${String(key)}":`, error);
      }
    });
  };

  return {
    has: hasItem,
    set: setItem,
    get: getItem,
    delete: removeItem,
    clear,
    on,
    once,
    emit,
  };
};

export { useEventStore };
