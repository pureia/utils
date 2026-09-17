import { stableStringify } from '@purea/utils';
import { afterEach, describe, expect, it } from 'vitest';

describe('stableStringify', () => {
  describe('基本对象 key 排序', () => {
    it('应按照字母序排列对象 key', () => {
      const obj = { c: 3, a: 1, b: 2 };
      expect(stableStringify(obj)).toBe('{"a":1,"b":2,"c":3}');
    });

    it('相同内容不同插入顺序应产生一致的字符串', () => {
      const obj1 = { z: 1, a: 2 };
      const obj2 = { a: 2, z: 1 };
      expect(stableStringify(obj1)).toBe(stableStringify(obj2));
    });

    it('大写字母应排在小写字母前（UTF-16 码元序）', () => {
      const obj = { a: 1, Z: 2 };
      expect(stableStringify(obj)).toBe('{"Z":2,"a":1}');
    });

    it('空对象应输出 {}', () => {
      expect(stableStringify({})).toBe('{}');
    });

    it('整数类键不按数值优先排序（已记录差异，与原生不同）', () => {
      // CONTEXT.md「稳定序列化」词条记录的差异：原生会把类数组整数键排在最前，此处统一按码元序
      expect(stableStringify({ 10: 'x', 2: 'y', 0: 'z' })).toBe('{"0":"z","10":"x","2":"y"}');
    });
  });

  describe('嵌套对象递归排序', () => {
    it('应递归排序嵌套对象的 key', () => {
      const obj = { b: { z: 6, y: 5, x: 4 }, a: 3 };
      expect(stableStringify(obj)).toBe('{"a":3,"b":{"x":4,"y":5,"z":6}}');
    });

    it('多层嵌套应全部排序', () => {
      const obj = { c: { d: { e: 1, a: 2 } }, a: 3 };
      expect(stableStringify(obj)).toBe('{"a":3,"c":{"d":{"a":2,"e":1}}}');
    });
  });

  describe('数组处理', () => {
    it('数组元素应保持原始索引顺序', () => {
      expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
    });

    it('数组中嵌套对象应递归排序 key', () => {
      const arr = [{ c: 1, a: 2 }, { z: 3, b: 4 }];
      expect(stableStringify(arr)).toBe('[{"a":2,"c":1},{"b":4,"z":3}]');
    });

    it('空数组应输出 []', () => {
      expect(stableStringify([])).toBe('[]');
    });

    it('数组中 undefined 元素应输出 null', () => {
      expect(stableStringify([1, undefined, 3])).toBe('[1,null,3]');
    });

    it('稀疏数组应正确处理', () => {
      // eslint-disable-next-line no-sparse-arrays
      const arr = [1, , 3];
      expect(stableStringify(arr)).toBe('[1,null,3]');
    });

    it('数组中非有限数字应输出 null', () => {
      expect(stableStringify([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])).toBe('[null,null,null]');
    });

    it('数组中混合原始值应正确序列化', () => {
      expect(stableStringify([true, false, 42, 3.14, 'hello'])).toBe('[true,false,42,3.14,"hello"]');
    });
  });

  describe('space 缩进', () => {
    it('space 为数字时应使用对应数量空格缩进', () => {
      const obj = { a: 1, b: 2 };
      expect(stableStringify(obj, { space: 2 })).toBe('{\n  "a": 1,\n  "b": 2\n}');
    });

    it('space 为字符串时应使用该字符串作为缩进', () => {
      const obj = { a: 1 };
      expect(stableStringify(obj, { space: '\t' })).toBe('{\n\t"a": 1\n}');
    });

    it('space 为 0 时应输出紧凑格式', () => {
      const obj = { a: 1, b: 2 };
      expect(stableStringify(obj, { space: 0 })).toBe('{"a":1,"b":2}');
    });

    it('无 space 时应输出紧凑格式', () => {
      const obj = { a: 1, b: 2 };
      expect(stableStringify(obj)).toBe('{"a":1,"b":2}');
    });

    it('嵌套对象应逐级增加缩进', () => {
      const obj = { a: { b: 1 } };
      expect(stableStringify(obj, { space: 2 })).toBe('{\n  "a": {\n    "b": 1\n  }\n}');
    });

    it('数组元素与其中的嵌套对象应逐级缩进', () => {
      expect(stableStringify([1, { z: 1, a: 2 }], { space: 2 })).toBe('[\n  1,\n  {\n    "a": 2,\n    "z": 1\n  }\n]');
    });
  });

  describe('cmp 自定义排序', () => {
    it('应支持自定义排序比较函数', () => {
      const obj = { c: 3, a: 1, b: 2 };
      // 按照 value 大小排序
      const result = stableStringify(obj, {
        cmp: (a, b) => a.value - b.value,
      });
      expect(result).toBe('{"a":1,"b":2,"c":3}');
    });

    it('应支持直接传比较函数作为第二个参数', () => {
      const obj = { c: 3, a: 1, b: 2 };
      const result = stableStringify(obj, (a, b) => b.value - a.value);
      expect(result).toBe('{"c":3,"b":2,"a":1}');
    });

    it('应支持三参数比较函数（带 getter）', () => {
      const obj = { a: 1, b: 2, c: 3 };
      // 使用 getter 获取相邻 key 的值进行比较
      const result = stableStringify(obj, {
        cmp: (a, b, getter) => {
          const va = getter ? getter.get(a.key) : a.value;
          const vb = getter ? getter.get(b.key) : b.value;
          return vb - va;
        },
      });
      expect(result).toBe('{"c":3,"b":2,"a":1}');
    });

    it('第三参带默认值的比较器同样收到 getter（不再按 Function.length 嗅探）', () => {
      // (a, b, getter = null) 的 length 为 2；若按 length > 2 嗅探，这类比较器会静默拿不到 getter、
      // 排序走偏。getter 现无条件注入，故不依赖声明的形参个数
      const withDefault = (a: any, b: any, getter: any = null) =>
        (getter ? getter.get(b.key) - getter.get(a.key) : 0);
      expect(stableStringify({ b: 1, a: 2 }, { cmp: withDefault })).toBe('{"a":2,"b":1}');
      expect(stableStringify({ b: 1, a: 2 }, withDefault)).toBe('{"a":2,"b":1}');
    });

    it('同一节点内的多次比较复用同一个 getter 对象', () => {
      // getter 每节点构造一次并复用（而非每次比较新建）：比较器可把它当"本节点上下文"挂状态或做记忆化，
      // 故一次调用内拿到的必须是同一个对象
      const getters = new Set<unknown>();
      stableStringify({ c: 3, a: 1, b: 2 }, {
        cmp: (a, b, getter) => {
          getters.add(getter);
          return a.key < b.key ? -1 : 1;
        },
      });
      expect(getters.size).toBe(1);
    });

    it('嵌套对象中每一层使用相同的 cmp', () => {
      const obj = { b: { z: 6, y: 5 }, a: 3 };
      const result = stableStringify(obj, (a, b) => b.value - a.value);
      expect(result).toBe('{"b":{"z":6,"y":5},"a":3}');
    });
  });

  describe('replacer 函数', () => {
    it('replacer 可以过滤特定 key', () => {
      const obj = { a: 1, b: 2, c: 3 };
      const result = stableStringify(obj, {
        replacer: (_parent, key, value) => (key === 'b' ? undefined : value),
      });
      expect(result).toBe('{"a":1,"c":3}');
    });

    it('replacer 可以修改值', () => {
      const obj = { a: 1, b: 2 };
      const result = stableStringify(obj, {
        replacer: (_parent, _key, value) => (typeof value === 'number' ? value * 2 : value),
      });
      expect(result).toBe('{"a":2,"b":4}');
    });

    it('replacer 可以访问 parent 对象', () => {
      const obj = { a: 1, b: 2, c: 3 };
      // 通过 parent 携带元数据，过滤掉特定值
      const result = stableStringify(obj, {
        replacer: (_parent, _key, value) => {
          if (typeof value === 'object' && value !== null) return value;
          // 只保留偶数
          return value % 2 === 0 ? value : undefined;
        },
      });
      expect(result).toBe('{"b":2}');
    });
  });

  describe('cycles 循环引用', () => {
    it('默认应对循环引用抛出 TypeError', () => {
      const obj: Record<string, any> = { a: 1 };
      obj.self = obj;
      expect(() => stableStringify(obj)).toThrow(TypeError);
      expect(() => stableStringify(obj)).toThrow('Converting circular structure to JSON');
    });

    it('cycles: true 时应将循环引用序列化为 "__cycle__"', () => {
      const obj: Record<string, any> = { a: 1 };
      obj.self = obj;
      const result = stableStringify(obj, { cycles: true });
      // 排序后 a 在前，self 在后
      expect(result).toBe('{"a":1,"self":"__cycle__"}');
    });

    it('cycles 严格判定为 === true，其余取值一律视为 false', () => {
      const make = () => { const o: Record<string, any> = { a: 1 }; o.self = o; return o; };
      expect(stableStringify(make(), { cycles: true })).toBe('{"a":1,"self":"__cycle__"}');
      // 非 true 的真值与其他类型：一律按未启用处理，故遇到循环引用仍抛 TypeError
      expect(() => stableStringify(make(), { cycles: 1 as any })).toThrow(TypeError);
      expect(() => stableStringify(make(), { cycles: 'yes' as any })).toThrow(TypeError);
      expect(() => stableStringify(make(), { cycles: 1n as any })).toThrow(TypeError);
    });

    it('嵌套循环引用应正确处理', () => {
      const child: Record<string, any> = { name: 'child' };
      const parent: Record<string, any> = { name: 'parent', child };
      child.parent = parent;
      const result = stableStringify(parent, { cycles: true });
      // parent 排序后: child, name -> child 排序后: name, parent
      expect(result).toBe('{"child":{"name":"child","parent":"__cycle__"},"name":"parent"}');
    });

    it('数组中的循环引用应正确处理', () => {
      const arr: any[] = [1];
      arr.push(arr);
      const result = stableStringify(arr, { cycles: true });
      expect(result).toBe('[1,"__cycle__"]');
    });

    it('bigint 值应抛 TypeError（对齐原生 JSON.stringify）', () => {
      expect(() => JSON.stringify(1n)).toThrow(TypeError);
      expect(() => stableStringify({ n: 1n })).toThrow(TypeError);
    });
  });

  describe('toJSON 自动调用', () => {
    it('应自动调用 toJSON 方法', () => {
      const obj = {
        a: 1,
        b: {
          value: 42,
          toJSON() {
            return this.value;
          },
        },
      };
      expect(stableStringify(obj)).toBe('{"a":1,"b":42}');
    });

    it('toJSON 返回值应继续参与后续递归排序', () => {
      const obj = {
        a: 1,
        b: {
          toJSON() {
            return { z: 3, y: 2 };
          },
        },
      };
      expect(stableStringify(obj)).toBe('{"a":1,"b":{"y":2,"z":3}}');
    });
  });

  describe('数组元素 key 类型（与原生 JSON.stringify 一致）', () => {
    it('toJSON 的 key 参数对数组元素为索引字符串', () => {
      const libKeys: unknown[] = [];
      const nativeKeys: unknown[] = [];
      stableStringify([{ toJSON(k: unknown) { libKeys.push(k); return k; } }]);
      JSON.stringify([{ toJSON(k: unknown) { nativeKeys.push(k); return k; } }]);
      expect(libKeys).toEqual(['0']);
      expect(libKeys).toEqual(nativeKeys);
    });

    it('replacer 的 key 对数组元素为索引字符串（根为空字符串）', () => {
      const keys: unknown[] = [];
      stableStringify([1, 2], {
        replacer: (_parent, key, value) => { keys.push(key); return value; },
      });
      expect(keys).toEqual(['', '0', '1']);
    });
  });

  describe('空容器格式（与原生 JSON.stringify 对齐）', () => {
    it('pretty-print 模式下空对象应紧凑输出 {}', () => {
      expect(stableStringify({}, { space: 2 })).toBe('{}');
      expect(stableStringify({}, { space: 2 })).toBe(JSON.stringify({}, null, 2));
    });

    it('pretty-print 模式下嵌套空对象应紧凑输出', () => {
      const obj = { a: {} };
      expect(stableStringify(obj, { space: 2 })).toBe('{\n  "a": {}\n}');
      expect(stableStringify(obj, { space: 2 })).toBe(JSON.stringify(obj, null, 2));
    });

    it('pretty-print 模式下空数组应紧凑输出 []', () => {
      const obj = { a: [] };
      expect(stableStringify(obj, { space: 2 })).toBe('{\n  "a": []\n}');
      expect(stableStringify(obj, { space: 2 })).toBe(JSON.stringify(obj, null, 2));
    });
  });

  describe('space 归一化（与原生 JSON.stringify 对齐）', () => {
    it('负数应视为无缩进', () => {
      expect(stableStringify({ a: 1 }, { space: -1 })).toBe('{"a":1}');
      expect(stableStringify({ a: 1 }, { space: -1 })).toBe(JSON.stringify({ a: 1 }, null, -1));
    });

    it('小数应截断而非四舍五入', () => {
      expect(stableStringify({ a: 1 }, { space: 1.5 })).toBe(JSON.stringify({ a: 1 }, null, 1.5));
      expect(stableStringify({ a: 1 }, { space: 1.9 })).toBe(JSON.stringify({ a: 1 }, null, 1.9));
    });

    it('超过 10 的数字应钳制为 10 个空格', () => {
      expect(stableStringify({ a: 1 }, { space: 11 })).toBe(JSON.stringify({ a: 1 }, null, 11));
      expect(stableStringify({ a: 1 }, { space: 100 })).toBe(JSON.stringify({ a: 1 }, null, 100));
    });

    it('space 为 Infinity 时应钳制为 10 个空格而非挂死/OOM', () => {
      expect(stableStringify({ a: 1 }, { space: Number.POSITIVE_INFINITY })).toBe(JSON.stringify({ a: 1 }, null, Number.POSITIVE_INFINITY));
    });

    it('space 为 NaN 时应视为无缩进', () => {
      expect(stableStringify({ a: 1 }, { space: Number.NaN })).toBe('{"a":1}');
    });

    it('非数字/字符串类型应视为无缩进（与原生一致）', () => {
      expect(stableStringify({ a: 1 }, { space: true as any })).toBe(JSON.stringify({ a: 1 }, null, true as any));
    });

    it('字符串缩进应截取前 10 个码元', () => {
      const s = 'x'.repeat(20);
      expect(stableStringify({ a: 1 }, { space: s })).toBe(JSON.stringify({ a: 1 }, null, s));
    });
  });

  describe('特殊值处理', () => {
    it('null 应序列化为 "null"', () => {
      expect(stableStringify(null)).toBe('null');
    });

    it('undefined 作为顶层值应返回 undefined（与 JSON.stringify 一致）', () => {
      expect(stableStringify(undefined)).toBeUndefined();
    });

    it('naN 应序列化为 null', () => {
      expect(stableStringify(Number.NaN)).toBe('null');
    });

    it('infinity 应序列化为 null', () => {
      expect(stableStringify(Infinity)).toBe('null');
    });

    it('-Infinity 应序列化为 null', () => {
      expect(stableStringify(-Infinity)).toBe('null');
    });

    it('布尔值应正确序列化', () => {
      expect(stableStringify(true)).toBe('true');
      expect(stableStringify(false)).toBe('false');
    });

    it('数字应正确序列化', () => {
      expect(stableStringify(42)).toBe('42');
      expect(stableStringify(3.14)).toBe('3.14');
    });

    it('字符串应正确序列化', () => {
      expect(stableStringify('hello')).toBe('"hello"');
    });

    it('对象属性值为 undefined 时应跳过该键', () => {
      expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
    });
  });

  describe('与 JSON.stringify 的一致性', () => {
    it('相同内容不同顺序的对象（含嵌套）应通过 stableStringify 产生一致结果', () => {
      const obj1 = { b: 2, a: 1, c: { e: 5, d: 4 } };
      const obj2 = { c: { d: 4, e: 5 }, a: 1, b: 2 };
      expect(stableStringify(obj1)).toBe(stableStringify(obj2));
    });
  });

  // 本组用例专门验证「装箱原始值」，必须真正构造包装对象。no-new-wrappers 与
  // unicorn/new-for-builtins 拦截的正是这类构造，其本意是防误用；此处属有意为之，
  // 故在块级关闭这两条规则（与文件内 no-sparse-arrays 的既有处置方式一致）
  /* eslint-disable no-new-wrappers, unicorn/new-for-builtins */
  describe('装箱原始值（对齐原生 JSON.stringify）', () => {
    it('应拆箱 Number / String / Boolean / BigInt 包装对象', () => {
      expect(stableStringify(new Number(3))).toBe('3');
      expect(stableStringify(new String('ab'))).toBe('"ab"');
      expect(stableStringify(new Boolean(false))).toBe('false');
      expect(() => stableStringify(new Object(5n))).toThrow(TypeError);
    });

    it('包装对象带自有属性时仍按其内部槽序列化', () => {
      const boxed = new Number(3);
      (boxed as any).x = 1;
      expect(stableStringify(boxed)).toBe('3');
      expect(stableStringify(boxed)).toBe(JSON.stringify(boxed));
    });

    it('嵌套在对象与数组中的包装对象同样拆箱', () => {
      const value = { a: new Number(1), b: [new String('s')] };
      expect(stableStringify(value)).toBe('{"a":1,"b":["s"]}');
      expect(stableStringify(value)).toBe(JSON.stringify(value));
    });

    it('space 传装箱 Number / String 时应与原生一致地缩进', () => {
      expect(stableStringify({ a: 1 }, { space: new Number(2) as any })).toBe('{\n  "a": 1\n}');
      expect(stableStringify({ a: 1 }, { space: new Number(2) as any })).toBe(JSON.stringify({ a: 1 }, null, new Number(2) as any));
      expect(stableStringify({ a: 1 }, { space: new String('\t') as any })).toBe('{\n\t"a": 1\n}');
      expect(stableStringify({ a: 1 }, { space: new String('\t') as any })).toBe(JSON.stringify({ a: 1 }, null, new String('\t') as any));
    });

    it('覆写 valueOf / toString 的包装对象按规范取值（Number 用 ToNumber、String 用 ToString、Boolean 读槽）', () => {
      // 规范：Number 走 ToNumber、String 走 ToString（两者都会沿可覆写的 valueOf/toString 求值），
      // Boolean 与 BigInt 才直接读内部槽——故四类不能统一用 valueOf
      const bool: any = new Boolean(false);
      bool.valueOf = () => true;
      expect(stableStringify(bool)).toBe(JSON.stringify(bool));

      const str: any = new String('ab');
      str.toString = () => 'zz';
      expect(stableStringify(str)).toBe(JSON.stringify(str));

      const num: any = new Number(3);
      num.valueOf = () => ({});
      expect(stableStringify(num)).toBe(JSON.stringify(num));

      const num2: any = new Number(3);
      num2.valueOf = 5;
      expect(stableStringify(num2)).toBe(JSON.stringify(num2));
    });

    it('伪造的 Symbol.toStringTag 标签不会被误拆箱（须经内部槽品牌检查确认）', () => {
      class Fake {
        get [Symbol.toStringTag]() { return 'Number'; }
        valueOf() { return 5; }
      }
      const value = { a: new Fake() };
      expect(stableStringify(value)).toBe(JSON.stringify(value));
    });

    it('tag getter 抛错的对象按普通对象序列化（原生不读该属性，故不抛错）', () => {
      let reads = 0;
      class TagThrower {
        get [Symbol.toStringTag]() { reads++; throw new Error('tag getter boom'); }
      }
      const value = { a: new TagThrower() };
      expect(stableStringify(value)).toBe('{"a":{}}');
      expect(stableStringify(value)).toBe(JSON.stringify(value));
      // 原生根本不读该属性，本实现同样一次都不读（读取会触发 getter：抛错或有副作用）
      expect(reads).toBe(0);
    });

    it('包装对象带伪造的 Symbol.toStringTag 时仍按内部槽拆箱', () => {
      const num: any = new Number(3);
      Object.defineProperty(num, Symbol.toStringTag, { value: 'Foo' });
      expect(stableStringify(num)).toBe('3');
      expect(stableStringify(num)).toBe(JSON.stringify(num));

      // 标签伪造成另一类包装：仍按真实内部槽取值
      const str: any = new String('ab');
      Object.defineProperty(str, Symbol.toStringTag, { value: 'Number' });
      expect(stableStringify(str)).toBe(JSON.stringify(str));
    });

    it('包装对象带抛错的 Symbol.toStringTag getter 时仍按内部槽拆箱，且该 getter 从未被触发', () => {
      let reads = 0;
      const num: any = new Number(3);
      Object.defineProperty(num, Symbol.toStringTag, {
        get() { reads++; throw new Error('tag getter boom'); },
      });
      expect(stableStringify(num)).toBe('3');
      expect(stableStringify(num)).toBe(JSON.stringify(num));
      expect(reads).toBe(0);
    });

    it('自带 Symbol.toStringTag 的包装子类同样按内部槽拆箱', () => {
      class Tagged extends Number {
        get [Symbol.toStringTag]() { return 'Tagged'; }
      }
      const value = { a: new Tagged(4) };
      expect(stableStringify(value)).toBe('{"a":4}');
      expect(stableStringify(value)).toBe(JSON.stringify(value));
    });

    it('链上有包装原型但无对应内部槽的对象不被拆箱', () => {
      const fake: any = Object.create(Number.prototype);
      fake.a = 1;
      Object.defineProperty(fake, Symbol.toStringTag, { value: 'Foo' });
      expect(stableStringify(fake)).toBe('{"a":1}');
      expect(stableStringify(fake)).toBe(JSON.stringify(fake));
    });

    it('原型被换成另一类包装原型时仍按真实内部槽取值', () => {
      // 链上是 Number.prototype、内部槽却是 [[BooleanData]]：命中的 Number 槽探测失败后兜底探测
      // 其余三类，命中真实槽——与原生同值
      const bool: any = new Boolean(false);
      Object.setPrototypeOf(bool, Number.prototype);
      Object.defineProperty(bool, Symbol.toStringTag, { value: 'Foo' });
      expect(stableStringify(bool)).toBe('false');
      expect(stableStringify(bool)).toBe(JSON.stringify(bool));

      // 内部槽是 [[StringData]] 时取值走 ToString，而它会调用现在的 Number.prototype.toString——
      // 与原生同样抛 TypeError（取值不被槽检查的 catch 吞掉）
      const str: any = new String('ab');
      Object.setPrototypeOf(str, Number.prototype);
      expect(() => stableStringify(str)).toThrow(TypeError);

      const fresh: any = new String('ab');
      Object.setPrototypeOf(fresh, Number.prototype);
      expect(() => JSON.stringify(fresh)).toThrow(TypeError);
    });

    it('包装对象取值抛错时异常向调用方传播（不被槽检查的 catch 吞掉）', () => {
      const native: any = new Number(3);
      native.valueOf = () => { throw new Error('valueOf boom'); };
      expect(() => JSON.stringify(native)).toThrow('valueOf boom');

      const mine: any = new Number(3);
      mine.valueOf = () => { throw new Error('valueOf boom'); };
      expect(() => stableStringify(mine)).toThrow('valueOf boom');
    });

    it('space 传装箱 Boolean 或其他对象时不缩进（原生仅拆箱 Number / String）', () => {
      expect(stableStringify({ a: 1 }, { space: new Boolean(true) as any })).toBe('{"a":1}');
      expect(stableStringify({ a: 1 }, { space: new Boolean(true) as any })).toBe(JSON.stringify({ a: 1 }, null, new Boolean(true) as any));
      expect(stableStringify({ a: 1 }, { space: new Date(0) as any })).toBe('{"a":1}');
      expect(stableStringify({ a: 1 }, { space: new Date(0) as any })).toBe(JSON.stringify({ a: 1 }, null, new Date(0) as any));
    });
  });
  /* eslint-enable no-new-wrappers, unicorn/new-for-builtins */

  describe('toJSON 查找语义（对齐原生 JSON.stringify）', () => {
    it('toJSON 为 accessor 时只读取一次，且 this 绑定不变', () => {
      // 每次构造独立对象：两个断言各自消费新的读取计数
      const make = () => {
        let reads = 0;
        const value = {
          get toJSON() {
            reads++;
            return function (this: unknown) { return `read${reads}:${typeof this === 'object'}`; };
          },
        };
        return { value, reads: () => reads };
      };

      const native = make();
      expect(JSON.stringify(native.value)).toBe('"read1:true"');
      expect(native.reads()).toBe(1);

      const mine = make();
      expect(stableStringify(mine.value)).toBe('"read1:true"');
      expect(mine.reads()).toBe(1);
    });

    it('真值原始值不查找 toJSON（原生仅对 Object 与 BigInt 查找）', () => {
      (String.prototype as any).toJSON = function () { return 'STR'; };
      (Number.prototype as any).toJSON = function () { return 'NUM'; };
      try {
        expect(stableStringify({ a: 'x' })).toBe('{"a":"x"}');
        expect(stableStringify([5, 0])).toBe('[5,0]');
      }
      finally {
        delete (String.prototype as any).toJSON;
        delete (Number.prototype as any).toJSON;
      }
    });

    it('原始值 BigInt 查找 toJSON，且 0n 与 1n 行为一致（含收到的属性 key）', () => {
      // 以「收到的 key」判别，而非输出或调用次数：未修复时 0n（假值）会跳过 toJSON，
      // 落到 JSON.stringify(0n)，而那条路径以根 key '' 调用同一个被污染的方法——
      // 输出与调用次数都会假通过，只有 key 能区分这两条路径
      let keys: unknown[] = [];
      (BigInt.prototype as any).toJSON = function (key: unknown) { keys.push(key); return 'BIG'; };
      try {
        keys = [];
        expect(stableStringify({ a: 1n })).toBe('{"a":"BIG"}');
        expect(keys).toEqual(['a']);

        keys = [];
        expect(stableStringify({ a: 0n })).toBe('{"a":"BIG"}');
        expect(keys).toEqual(['a']);
      }
      finally {
        delete (BigInt.prototype as any).toJSON;
      }
    });

    it('带 toJSON 的函数按原生语义被调用（函数亦属 Object）', () => {
      const fn: any = () => {};
      fn.toJSON = () => 42;
      expect(stableStringify({ a: fn })).toBe('{"a":42}');
      expect(stableStringify({ a: fn })).toBe(JSON.stringify({ a: fn }));
    });
  });

  describe('数组长度在遍历前快照（对齐原生 JSON.stringify）', () => {
    it('replacer 追加元素不改变本次输出', () => {
      const native = [1, 2];
      // 该 replacer 体只用闭包变量 native、不使用 this，故用箭头函数（原生此回调的 this 绑定为持有者）
      expect(JSON.stringify(native, (key: string, value: any) => { if (key === '0') native.push(3); return value; })).toBe('[1,2]');

      const mine = [1, 2];
      expect(stableStringify(mine, {
        replacer: (_parent, key, value) => { if (key === '0') mine.push(3); return value; },
      })).toBe('[1,2]');
    });

    it('replacer 截断数组时仍按原长度产出（被截断处补 null）', () => {
      const native = [1, 2, 3];
      expect(JSON.stringify(native, function (this: any, key: string, value: any) { if (key === '0') this.length = 1; return value; })).toBe('[1,null,null]');

      const mine = [1, 2, 3];
      expect(stableStringify(mine, {
        replacer: (parent, key, value) => { if (key === '0') parent.length = 1; return value; },
      })).toBe('[1,null,null]');
    });

    it('replacer 拉长数组时不产出新增下标', () => {
      const native = [1, 2];
      expect(JSON.stringify(native, function (this: any, key: string, value: any) { if (key === '0') this[5] = 9; return value; })).toBe('[1,2]');

      const mine = [1, 2];
      expect(stableStringify(mine, {
        replacer: (parent, key, value) => { if (key === '0') parent[5] = 9; return value; },
      })).toBe('[1,2]');
    });
  });

  describe('非函数 cmp 静默忽略（对齐原生忽略非函数 replacer 的姿态）', () => {
    // 非函数 cmp 此前会在 sort 比较器内部抛 "cmpOpt is not a function"，
    // 且只有存在 ≥2 个键的节点才会走到排序，故此处一律用双键对象暴露
    it('cmp 为非函数真值时按未提供处理', () => {
      const obj = () => ({ b: 2, a: 1 });
      expect(stableStringify(obj(), { cmp: 5 as any })).toBe('{"a":1,"b":2}');
      expect(stableStringify(obj(), { cmp: 'x' as any })).toBe('{"a":1,"b":2}');
      expect(stableStringify(obj(), { cmp: true as any })).toBe('{"a":1,"b":2}');
      expect(stableStringify(obj(), { cmp: {} as any })).toBe('{"a":1,"b":2}');
      expect(stableStringify(obj(), { cmp: [] as any })).toBe('{"a":1,"b":2}');
    });

    it('第二个参数为非函数非对象时同样按未提供处理', () => {
      expect(stableStringify({ b: 2, a: 1 }, 'x' as any)).toBe('{"a":1,"b":2}');
      expect(stableStringify({ b: 2, a: 1 }, 5 as any)).toBe('{"a":1,"b":2}');
    });

    it('合法 cmp 不受影响（两参与三参仍生效）', () => {
      expect(stableStringify({ b: 1, a: 2 }, (x: any, y: any) => y.value - x.value)).toBe('{"a":2,"b":1}');
      expect(stableStringify({ b: 1, a: 2 }, { cmp: (x: any, y: any, g: any) => (g ? g.get(y.key) - g.get(x.key) : 0) })).toBe('{"a":2,"b":1}');
    });
  });

  describe('仿请求配置对象的输出稳定（createFetch 去重键输入）', () => {
    // createFetch 以 stableStringify(全量合并配置) 的哈希作为去重键，
    // 故这一形状的输出必须逐字节稳定——改动它等于静默换掉请求的去重分组
    const requestConfig = () => ({
      url: '/users',
      host: 'https://api.example.com',
      method: 'GET',
      header: { 'Content-Type': 'application/json' },
      timeout: 10000,
      isDedup: false,
    });

    it('紧凑模式与 space 2 下均产出预期字符串', () => {
      expect(stableStringify(requestConfig())).toBe('{"header":{"Content-Type":"application/json"},"host":"https://api.example.com","isDedup":false,"method":"GET","timeout":10000,"url":"/users"}');
      expect(stableStringify(requestConfig(), { space: 2 })).toBe('{\n  "header": {\n    "Content-Type": "application/json"\n  },\n  "host": "https://api.example.com",\n  "isDedup": false,\n  "method": "GET",\n  "timeout": 10000,\n  "url": "/users"\n}');
    });
  });

  /* eslint-disable no-new-wrappers, unicorn/new-for-builtins */

  /**
   * 内置原语被改写 / 替换时，装箱判定与取值不受影响——判定只认内部槽（含 Symbol.toStringTag 的取用）。
   *
   * 靠**与原生同进程逐字节比对**钉住，而不是写死本实现的输出。
   */

  /** 临时改写一个全局属性，afterEach 无条件还原（按描述符，含 symbol 键） */
  let restores: (() => void)[] = [];
  function patch(target: any, key: PropertyKey, value: unknown): void {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    target[key] = value;
    restores.push(() => {
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else Reflect.deleteProperty(target, key);
    });
  }
  afterEach(() => {
    const pending = restores;
    restores = [];
    for (const restore of pending) restore();
  });

  describe('内置原语被改写时的判定与取值（对齐原生 JSON.stringify）', () => {
    it('改写 Number.prototype.valueOf：无内部槽的对象仍按普通对象序列化', () => {
      const fake: any = Object.assign(Object.create(Number.prototype), { a: 1 });
      const expected = JSON.stringify(fake);
      patch(Number.prototype, 'valueOf', () => 42);
      expect(stableStringify(fake)).toBe(expected);
      expect(stableStringify(fake)).toBe('{"a":1}');
    });

    it('改写 Boolean.prototype.valueOf：无内部槽的对象不被拆箱', () => {
      const fake: any = Object.assign(Object.create(Boolean.prototype), { a: 1 });
      const expected = JSON.stringify(fake);
      patch(Boolean.prototype, 'valueOf', () => true);
      expect(stableStringify(fake)).toBe(expected);
    });

    it('改写 String.prototype.valueOf：不再抛 TypeError（取值路径不外溢误判）', () => {
      const fake: any = Object.assign(Object.create(String.prototype), { a: 1 });
      const expected = JSON.stringify(fake);
      patch(String.prototype, 'valueOf', () => 'patched');
      expect(stableStringify(fake)).toBe(expected);
    });

    it('改写 BigInt.prototype.valueOf：不再抛「Do not know how to serialize a BigInt」', () => {
      const fake: any = Object.assign(Object.create(BigInt.prototype), { a: 1 });
      const expected = JSON.stringify(fake);
      patch(BigInt.prototype, 'valueOf', () => 1n);
      expect(stableStringify(fake)).toBe(expected);
    });

    it('真包装值在改写后仍按 ToNumber 取值（value 路径保持实时求值，与原生同值）', () => {
      const real = new Number(7);
      patch(Number.prototype, 'valueOf', () => 42);
      expect(stableStringify(real)).toBe(JSON.stringify(real));
      expect(stableStringify(real)).toBe('42');
    });

    it('全局 Number 被替换：装箱取值仍走 ToNumber 而非被替换的函数对象', () => {
      const expected = JSON.stringify(new Number(7));
      patch(globalThis, 'Number', new Proxy(Number, { apply: () => 99 }));
      expect(stableStringify(new Number(7))).toBe(expected);
    });

    it('全局 String 被替换：装箱取值仍走 ToString 而非被替换的函数对象', () => {
      const expected = JSON.stringify(new String('ab'));
      patch(globalThis, 'String', new Proxy(String, { apply: () => 'hijacked' }));
      expect(stableStringify(new String('ab'))).toBe(expected);
    });

    it('全局 Symbol 被替换：判定仍按真实 @@toStringTag 走', () => {
      const boxed: any = new Boolean(false);
      Object.setPrototypeOf(boxed, Number.prototype);
      Object.defineProperty(boxed, Symbol.toStringTag, { value: 'Foo' });
      const expected = JSON.stringify(boxed);
      patch(globalThis, 'Symbol', new Proxy(Symbol, {
        get: (target, key, receiver) => (key === 'toStringTag' ? 'fake-tag' : Reflect.get(target, key, receiver)),
      }));
      expect(stableStringify(boxed)).toBe(expected);
      expect(stableStringify(boxed)).toBe('false');
    });
  });

  /**
   * 循环引用的 TypeError 文本按 V8（Node）口径：首行之后是 `--> starting at …` 路径详情。
   * 逐形状与原生同进程**逐字节比对**，而不是写死本实现的输出。
   */
  describe('循环引用报错文本（对齐原生 JSON.stringify，V8 口径）', () => {
    const messageOf = (fn: () => unknown): string => {
      try {
        fn();
      }
      catch (error) {
        expect(error).toBeInstanceOf(TypeError);
        return (error as TypeError).message;
      }
      throw new Error('期望抛出 TypeError，但没有抛');
    };

    const shapes: [string, () => unknown][] = [
      ['根对象自引用', () => { const o: any = { a: 1 }; o.self = o; return o; }],
      ['嵌套一跳', () => { const o: any = { a: 1 }; o.a = { b: o }; return o; }],
      ['嵌套两跳', () => { const o: any = {}; o.a = { b: { c: o } }; return o; }],
      ['数组自引用（索引闭合）', () => { const a: any[] = [1]; a.push(a); return a; }],
      ['数组 → 对象 → 数组', () => { const a: any[] = [1]; const o: any = { a }; a.push(o); return a; }],
      ['对象 → 数组 → 索引闭合', () => { const o: any = { list: [] }; o.list.push(o); return o; }],
      ['类实例自引用', () => { class C { x = 1; } const c: any = new C(); c.self = c; return c; }],
      ['类实例 → 普通对象 → 类实例', () => { class C { x = 1; } const c: any = new C(); c.o = { back: c }; return c; }],
      ['原型为 null 的对象', () => { const o: any = Object.create(null); o.self = o; return o; }],
      ['重复点不是根', () => { const a: any = {}; const b: any = { a }; a.b = b; return a; }],
      ['toJSON 返回含环对象', () => { const o: any = {}; o.self = o; return { toJSON: () => o }; }],
      ['并列的两个自引用对象（命中第一个）', () => { const a: any = {}; a.self = a; const b: any = {}; b.self = b; return { a, b }; }],
      ['空键闭合 → <anonymous>', () => { const o: any = {}; o[''] = o; return o; }],
      ['空键出现在中间跳', () => { const o: any = {}; o[''] = { b: o }; return o; }],
      ['键含单引号（不转义）', () => { const o: any = {}; o[`a${String.fromCharCode(39)}b`] = o; return o; }],
      ['数组下标 12', () => { const a: any[] = []; for (let i = 0; i < 12; i++) a.push(i); a.push(a); return a; }],
      ['稀疏数组下标 4', () => { const a: any[] = []; a.length = 5; a[4] = a; return a; }],
      ['Proxy 包类实例', () => { class P { x = 1; } const t: any = new P(); t.self = t; return new Proxy(t, {}); }],
      ['Proxy getPrototypeOf → null', () => { const t: any = {}; t.self = t; return new Proxy(t, { getPrototypeOf: () => null }); }],
      ['仅原型装着 Number 的自引用对象', () => { const o: any = Object.create(Number.prototype); o.self = o; return o; }],
      ['原型的 constructor 是 getter（不触发）', () => { const o: any = Object.create({ get constructor() { return function FromGetter() {}; } }); o.self = o; return o; }],
      ['原型的 constructor 是 undefined', () => { const o: any = Object.create({ constructor: undefined }); o.self = o; return o; }],
      ['原型的 constructor 非函数', () => { const o: any = Object.create({ constructor: 5 }); o.self = o; return o; }],
      ['原型的 constructor 是匿名函数', () => { const o: any = Object.create({ constructor() {} }); o.self = o; return o; }],
    ];

    for (const [name, make] of shapes) {
      it(`${name}：与原生逐字节一致`, () => {
        expect(messageOf(() => stableStringify(make()))).toBe(messageOf(() => JSON.stringify(make())));
      });
    }
  });

  /**
   * JSDoc 自陈、此前无用例覆盖的两处边界——重构期间的护栏。
   *
   * 两处都**与原生不一致**，所以这里钉的不是「与原生相同」，而是「本实现与原生各自确定的现状」：
   * 重构若把这两处边界挪走，会在这里变红（挪走属于行为变更，需要单独排期，不能夹带在重构里）。
   */
  describe('已知边界：原型重置与 Proxy has 陷阱', () => {
    it('原型被重置为 Object.prototype / Array.prototype / null 的包装对象按普通对象序列化', () => {
      const resetTo = <T extends object>(value: T, proto: object | null): T => {
        Object.setPrototypeOf(value, proto);
        return value;
      };

      // 重置为 Object.prototype / Array.prototype：本实现按普通对象序列化（无自有可枚举属性故为 {}）；
      // 原生仍按内部槽拆箱，再沿重置后的原型链求 ToNumber / ToString
      expect(stableStringify(resetTo(new Number(5), Object.prototype))).toBe('{}');
      expect(JSON.stringify(resetTo(new Number(5), Object.prototype))).toBe('null');
      expect(stableStringify(resetTo(new Number(5), Array.prototype))).toBe('{}');
      expect(JSON.stringify(resetTo(new Number(5), Array.prototype))).toBe('0');

      // String 包装的自有索引属性可枚举，故普通对象序列化会带上它们
      expect(stableStringify(resetTo(new String('ab'), Object.prototype))).toBe('{"0":"a","1":"b"}');
      expect(JSON.stringify(resetTo(new String('ab'), Object.prototype))).toBe('"[object String]"');

      // 重置为 null：本实现仍是普通对象；原生取不到 valueOf / toString，直接抛 TypeError
      expect(stableStringify(resetTo(new Number(5), null))).toBe('{}');
      expect(() => JSON.stringify(resetTo(new Number(5), null))).toThrow(TypeError);

      // 自有可枚举属性照常输出，嵌套位置同样
      const withOwn = () => resetTo(Object.assign(new Number(5), { a: 1 }), null);
      expect(stableStringify(withOwn())).toBe('{"a":1}');
      expect(stableStringify({ n: withOwn() })).toBe('{"n":{"a":1}}');
    });

    it('链上带 Symbol.toStringTag 时 Proxy 会收到一次 has 陷阱（原生不调用该陷阱）', () => {
      // 原型不是 Object.prototype / Array.prototype / null，故 unbox 会执行到 `Symbol.toStringTag in node`。
      // 输出两边一致（Proxy 没有内部槽，都不拆箱），差别只在陷阱调用次数
      let mineHasCalls = 0;
      let nativeHasCalls = 0;
      const boxedProxy = (onHas: () => void) => new Proxy(new Number(5), {
        has: (target, key) => {
          onHas();
          return Reflect.has(target, key);
        },
      });

      expect(stableStringify(boxedProxy(() => { mineHasCalls++; }))).toBe('{}');
      expect(JSON.stringify(boxedProxy(() => { nativeHasCalls++; }))).toBe('{}');
      expect(mineHasCalls).toBe(1);
      expect(nativeHasCalls).toBe(0);
    });

    it('该 has 陷阱抛错时异常向调用方传播（原生不调用该陷阱，故照常序列化）', () => {
      const throwing = () => new Proxy(new Number(5), {
        has: () => {
          throw new Error('has boom');
        },
      });

      expect(() => stableStringify(throwing())).toThrow('has boom');
      expect(JSON.stringify(throwing())).toBe('{}');
    });
  });

  /* eslint-enable no-new-wrappers, unicorn/new-for-builtins */
});
