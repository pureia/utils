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
});
