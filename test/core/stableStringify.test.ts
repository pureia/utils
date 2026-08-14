import { describe, expect, it } from 'vitest';
import { stableStringify } from '@purea/utils';

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

    it('大写字母应排在小写字母前（UTF-16 码点序）', () => {
      const obj = { a: 1, Z: 2 };
      expect(stableStringify(obj)).toBe('{"Z":2,"a":1}');
    });

    it('空对象应输出 {}', () => {
      expect(stableStringify({})).toBe('{}');
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

    it('replacer 返回 undefined 时应跳过该属性', () => {
      const obj = { a: 1, b: 2 };
      const result = stableStringify(obj, {
        replacer: (_parent, key, value) => (key === 'a' ? undefined : value),
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

    it('date 对象应通过 toJSON 输出 ISO 字符串', () => {
      const date = new Date('2024-01-01T00:00:00.000Z');
      const result = stableStringify({ date });
      expect(result).toBe(`{"date":"${date.toJSON()}"}`);
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

  describe('collapseEmpty 扩展', () => {
    it('collapseEmpty: true 时空对象应紧凑输出 {}', () => {
      const obj = { a: {} };
      const result = stableStringify(obj, { collapseEmpty: true });
      expect(result).toBe('{"a":{}}');
    });

    it('collapseEmpty: true 时空数组应紧凑输出 []', () => {
      const obj = { a: [] };
      const result = stableStringify(obj, { collapseEmpty: true });
      expect(result).toBe('{"a":[]}');
    });

    it('collapseEmpty: true 时 pretty-print 模式下空对象也应紧凑输出', () => {
      const obj = { a: {} };
      const result = stableStringify(obj, { space: 2, collapseEmpty: true });
      expect(result).toBe('{\n  "a": {}\n}');
    });

    it('collapseEmpty: false 时 pretty-print 模式下空对象应换行缩进', () => {
      const obj = { a: {} };
      const result = stableStringify(obj, { space: 2, collapseEmpty: false });
      expect(result).toBe('{\n  "a": {\n  }\n}');
    });

    it('collapseEmpty 传入非 boolean 时应抛出 TypeError', () => {
      const obj = { a: 1 };
      expect(() => stableStringify(obj, { collapseEmpty: 1 as any })).toThrow(TypeError);
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
    it('相同内容不同顺序的对象应通过 stableStringify 产生一致结果', () => {
      const obj1 = { b: 2, a: 1, c: { e: 5, d: 4 } };
      const obj2 = { c: { d: 4, e: 5 }, a: 1, b: 2 };
      expect(stableStringify(obj1)).toBe(stableStringify(obj2));
    });

    it('简单值应与 JSON.stringify 一致', () => {
      expect(stableStringify('test')).toBe(JSON.stringify('test'));
      expect(stableStringify(123)).toBe(JSON.stringify(123));
      expect(stableStringify(true)).toBe(JSON.stringify(true));
      expect(stableStringify(null)).toBe(JSON.stringify(null));
    });

    it('纯数组应与 JSON.stringify 一致', () => {
      const arr = [1, 'two', true, null];
      expect(stableStringify(arr)).toBe(JSON.stringify(arr));
    });
  });
});
