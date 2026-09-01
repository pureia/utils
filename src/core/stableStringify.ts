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

/** 自定义 key 排序比较函数：接收 `{ key, value }` 对（第三个可选参数为按 key 取值函数），返回负数/0/正数决定排序 */
type CmpFunc = (
  a: { key: string; value: any },
  b: { key: string; value: any },
  getter?: { get: (key: string) => any }
) => number;

/** 过滤/转换函数：签名与原生 `JSON.stringify` 的 replacer 一致（key 恒为字符串，数组元素即索引字符串），返回 `undefined` 时跳过该属性 */
type ReplacerFunc = (this: any, parent: any, key: string, value: any) => any;

/**
 * `stableStringify` 选项；未提供的字段按原生 `JSON.stringify` 的默认语义处理。
 */
interface StableStringifyOptions {
  /** 缩进，对齐原生 JSON.stringify：数字截断并钳制到 [0, 10]（负数/NaN 视为无缩进），字符串仅取前 10 个码元 */
  space?: string | number;
  /** 自定义 key 排序比较函数；也可直接传比较函数作为第二个参数 */
  cmp?: CmpFunc;
  /** 过滤/转换函数，返回 `undefined` 跳过该属性 */
  replacer?: ReplacerFunc;
  /** 将循环引用序列化为 `"__cycle__"` 而非抛错，默认 false */
  cycles?: boolean;
}

/**
 * 确定性版本的 `JSON.stringify`：对象键按 UTF-16 码点排序，相同内容恒产出相同字符串。
 *
 * 与原生 `JSON.stringify` 的可观察差异：
 * - `replacer` 签名为 `(parent, key, value)`，第一个参数是父对象（替代原生的 `this` 绑定）
 * - `cycles: true` 时将循环引用序列化为 `"__cycle__"` 而非抛错
 * - 类数组整数键（如 `"2"`/`"10"`）不按数值优先排序（原生会将其排在最前），
 *   与其余键统一按码点序排序——确定性不受影响，但跨工具哈希比对时需注意
 *
 * 重载：第二参数要么是选项对象，要么是自定义比较函数，二者互斥（运行时按 typeof 判别）。
 *
 * @param obj - 要序列化的值
 * @param opts - 选项对象；也可直接传自定义比较函数（见重载，等价于 `opts.cmp` 的快捷形式）
 * @returns 稳定的 JSON 字符串；顶层值为 `undefined` 时返回 `undefined`
 * @throws {TypeError} 遇循环引用且 `cycles` 未启用时
 *
 * @example
 * // 基本排序
 * stableStringify({ c: 8, b: [{ z: 6 }, 7], a: 3 });
 * // => '{"a":3,"b":[{"z":6},7],"c":8}'
 * // 循环引用处理
 * const obj: any = { a: 1 };
 * obj.self = obj;
 * stableStringify(obj, { cycles: true });
 * // => '{"a":1,"self":"__cycle__"}'
 */
function stableStringify(obj: any, opts?: StableStringifyOptions): string | undefined;
function stableStringify(obj: any, cmp: CmpFunc): string | undefined;
function stableStringify(obj: any, opts?: StableStringifyOptions | CmpFunc): string | undefined {
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
  // 包装为按节点调用的比较器：每次比较都向 cmp 传入 { key, value } 对（取自当前节点）；
  // 仅当调用方 cmp 声明了第三个参数（按 key 取值函数）时才注入 getter，
  // 与原始 json-stable-stringify 的调用约定保持一致
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

  // 缩进/分隔符仅由 space 决定，提升为调用级常量并按需缓存（避免大对象深层嵌套下
  // 每个节点重复 space.repeat(level) 的字符串分配；原生 JSON.stringify 同样缓存）
  const indentCache = space ? new Map<number, string>() : null;
  const colonSeparator = space ? ': ' : ':';

  function stringify(parent: any, key: string, node: any, level: number): string | undefined {
    let indent = '';
    if (space) {
      const cached = indentCache!.get(level);
      if (cached !== undefined) {
        indent = cached;
      }
      else {
        indent = `\n${space.repeat(level)}`;
        indentCache!.set(level, indent);
      }
    }

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
        // key 恒为字符串（对齐原生 JSON.stringify）：数组元素传索引字符串，而非数字
        const item = stringify(node, String(i), node[i], level + 1);
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
