/**
 * 移植声明：本文件基于 json-stable-stringify（https://github.com/ljharb/json-stable-stringify）
 * 的 TypeScript 重写与改造。
 *
 * Original license (MIT):
 * Copyright (c) 2013 James Halliday
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

type CmpFunc = (
  a: { key: string; value: any },
  b: { key: string; value: any },
  getter?: { get: (key: string) => any }
) => number;

type ReplacerFunc = (this: any, parent: any, key: string | number, value: any) => any;

interface StableStringifyOptions {
  /** 缩进，对齐原生 JSON.stringify：数字截断并钳制到 [0, 10]（负数/NaN 视为无缩进），字符串仅取前 10 个码元 */
  space?: string | number;
  /**
   * 自定义 key 排序比较函数。
   * 接收 `{ key, value }` 对，返回负数/0/正数决定排序。
   * 也可以直接传比较函数作为第二个参数（兼容调用方式）。
   */
  cmp?: CmpFunc;
  /** 类似 JSON.stringify 的 replacer 函数 */
  replacer?: ReplacerFunc;
  /** 是否将循环引用序列化为 `"__cycle__"` 而非抛错，默认 false */
  cycles?: boolean;
}

/**
 * 确定性版本的 JSON.stringify —— 对对象 key 排序后序列化，确保相同内容产生一致字符串。
 *
 * 与原生 `JSON.stringify` 的核心区别：
 * - 对象 key 按字母序（UTF-16 码点）输出，而非插入顺序
 * - `replacer` 签名为 `(parent, key, value)`，第一个参数是父对象（替代了原生的 `this` 绑定）
 * - 支持 `cycles` 选项将循环引用序列化为 `"__cycle__"` 而非抛错
 * - 空容器（{} / []）恒紧凑输出，与原生一致
 *
 * @param obj - 要序列化的值
 * @param opts - 选项对象，或直接传入 `CmpFunc` 比较函数作为第二个参数
 * @param opts.space - 缩进，对齐原生 JSON.stringify：数字截断（ToIntegerOrInfinity）后钳制到 [0, 10]（负数/NaN → 无缩进），字符串仅取前 10 个码元；不传则输出紧凑格式
 * @param opts.cmp - 自定义 key 排序比较函数，签名 `({ key, value }, { key, value }, getter?) => number`
 * @param opts.replacer - 过滤/转换函数，签名 `(parent, key, value) => any`，返回 `undefined` 跳过该属性
 * @param opts.cycles - 为 `true` 时将循环引用序列化为 `"__cycle__"`，默认 `false` 则抛出 `TypeError`
 * @returns 稳定的 JSON 字符串；当顶层值为 `undefined` 时返回 `undefined`
 * @throws {TypeError} 遇到循环引用且 `cycles` 未启用时抛出
 *
 * @example
 * // 基本排序
 * const obj = { c: 8, b: [{ z: 6, y: 5, x: 4 }, 7], a: 3 };
 * stableStringify(obj);
 * // => '{"a":3,"b":[{"x":4,"y":5,"z":6},7],"c":8}'
 *
 * @example
 * // 自定义排序（按 value 降序）
 * stableStringify({ a: 1, b: 3, c: 2 }, (a, b) => b.value - a.value);
 * // => '{"b":3,"c":2,"a":1}'
 *
 * @example
 * // 循环引用处理
 * const obj: any = { a: 1 };
 * obj.self = obj;
 * stableStringify(obj, { cycles: true });
 * // => '{"a":1,"self":"__cycle__"}'
 *
 * @example
 * // pretty-print 模式
 * stableStringify({ a: 1, b: 2 }, { space: 2 });
 * // => '{\n  "a": 1,\n  "b": 2\n}'
 */
function stableStringify(obj: any, opts?: StableStringifyOptions | CmpFunc) {
  const isObj = opts != null && typeof opts === 'object';

  // 缩进对齐原生 JSON.stringify 语义：
  // - 数字：ToIntegerOrInfinity 截断后钳制到 [0, 10]（负数/NaN → 无缩进；Infinity/超大值 → 10，
  //   避免 strRepeat 无限循环与内存压力）
  // - 字符串：仅取前 10 个码元
  // - 其余类型（boolean 等）：原生按无缩进处理
  let space = '';
  if (isObj && opts.space !== undefined) {
    if (typeof opts.space === 'number') {
      const n = Math.trunc(opts.space);
      space = n >= 1 ? ' '.repeat(Math.min(10, n)) : '';
    }
    else if (typeof opts.space === 'string') {
      space = opts.space.slice(0, 10);
    }
  }
  const cycles = isObj && opts.cycles === true;

  const defaultReplacer: ReplacerFunc = (_parent, _key, value) => value;
  const replacer = isObj && typeof opts.replacer === 'function' ? opts.replacer : defaultReplacer;

  const cmpOpt = typeof opts === 'function' ? opts : (isObj ? opts.cmp : void 0);
  const cmp = cmpOpt
    ? (node: Record<string, any>) => {
        const get = cmpOpt.length > 2 ? (k: string) => node[k] : void 0;
        return (a: string, b: string) =>
          cmpOpt(
            { key: a, value: node[a] },
            { key: b, value: node[b] },
            get ? { get } : void 0
          );
      }
    : void 0;

  const seen = new Set<object>();

  function stringify(parent: any, key: string | number, node: any, level: number): string | undefined {
    const indent = space ? `\n${space.repeat(level)}` : '';
    const colonSeparator = space ? ': ' : ':';

    if (node && typeof node.toJSON === 'function') {
      node = node.toJSON(key);
    }

    node = replacer.call(parent, parent, key, node);
    if (node === undefined) return;

    if (typeof node !== 'object' || node === null) return JSON.stringify(node);

    // 空容器恒输出紧凑括号（与原生 JSON.stringify 一致，即使 pretty-print 模式）
    function groupOutput(out: string[], brackets: '[]' | '{}'): string {
      return out.length === 0
        ? brackets
        : (brackets === '[]' ? '[' : '{') + out.join(',') + indent + (brackets === '[]' ? ']' : '}');
    }

    if (seen.has(node)) {
      if (cycles) return JSON.stringify('__cycle__');
      throw new TypeError('Converting circular structure to JSON');
    }

    if (Array.isArray(node)) {
      seen.add(node);
      const out: string[] = [];
      for (let i = 0; i < node.length; i++) {
        const item = stringify(node, i, node[i], level + 1);
        out.push(indent + space + (item === undefined ? 'null' : item));
      }
      seen.delete(node);
      return groupOutput(out, '[]');
    }

    seen.add(node);

    const keys = Object.keys(node);
    const comparer = cmp ? cmp(node) : void 0;
    comparer ? keys.sort(comparer) : keys.sort();

    const out: string[] = [];
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const value = stringify(node, key, node[key], level + 1);

      if (value === undefined) continue;

      const keyValue = JSON.stringify(key) + colonSeparator + value;
      out.push(indent + space + keyValue);
    }

    seen.delete(node);

    return groupOutput(out, '{}');
  }

  return stringify({ '': obj }, '', obj, 0);
}

export { stableStringify };
export type { CmpFunc, ReplacerFunc, StableStringifyOptions };

export default stableStringify;
