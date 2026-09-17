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

/** 按节点产出的键比较器：由 resolveOptions 将调用方 cmp 包装为「每个节点一个比较器」的形态 */
type NodeComparator = (node: Record<string, any>) => (a: string, b: string) => number;

/** 遍历期使用的内部规范化选项（不对外导出）：公共选项/重载经 resolveOptions 归一后的结果 */
interface ResolvedOptions {
  space: string;
  cycles: boolean;
  replacer: ReplacerFunc;
  cmp?: NodeComparator;
}

/** 恒等 replacer：未提供 replacer 时的默认值（模块级常量，免去每次调用重新分配） */
const identityReplacer: ReplacerFunc = (_parent, _key, value) => value;

/**
 * Split Phase：把「公共选项 / 重载判别」归一为遍历期使用的内部记录。
 *
 * 只读 opts、不接触遍历状态——选项语义的变化（新增选项、调整归一规则、重载判别）
 * 集中在此处，不再与遍历本体耦合。
 *
 * @param opts - 第二参数：选项对象，或直接传入的自定义比较函数
 * @returns 归一后的内部选项
 */
function resolveOptions(opts: StableStringifyOptions | CmpFunc | undefined): ResolvedOptions {
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

  const replacer = isObj && typeof opts.replacer === 'function' ? opts.replacer : identityReplacer;

  const cmpOpt = typeof opts === 'function' ? opts : (isObj ? opts.cmp : void 0);
  // 包装为按节点调用的比较器：每次比较都向 cmp 传入 { key, value } 对（取自当前节点）；
  // 仅当调用方 cmp 声明了第三个参数（按 key 取值函数）时才注入 getter，
  // 与原始 json-stable-stringify 的调用约定保持一致。
  // 「是否注入 getter」只取决于调用方函数形态、单次调用内恒定，故在此判定一次而非每个节点重算。
  const withGetter = cmpOpt ? cmpOpt.length > 2 : false;
  const cmp: NodeComparator | undefined = cmpOpt
    ? (node: Record<string, any>) => {
        const get = withGetter ? (k: string) => node[k] : void 0;
        return (a: string, b: string) =>
          cmpOpt(
            { key: a, value: node[a] },
            { key: b, value: node[b] },
            get ? { get } : void 0
          );
      }
    : void 0;

  return { space, cycles: isObj && opts.cycles === true, replacer, cmp };
}

/**
 * 包裹已序列化的成员，产出容器字面量。
 *
 * 空容器恒输出紧凑括号（与原生 `JSON.stringify` 一致，即使 pretty-print 模式）；
 * 否则逐项以逗号连接、以本层缩进收尾。`open`/`close` 直接收字面量括号，
 * 免去按 `'[]' | '{}'` 标签二次解码同一判别。
 *
 * @param out - 已各自带缩进前缀的成员字符串
 * @param open - 开括号字面量
 * @param close - 闭括号字面量
 * @param indent - 本层缩进（仅非空容器使用）
 */
function wrap(out: string[], open: string, close: string, indent: string): string {
  return out.length === 0 ? open + close : open + out.join(',') + indent + close;
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
  const { space, cycles, replacer, cmp } = resolveOptions(opts);

  const seen = new Set<object>();

  // 分隔符仅由 space 决定，提升为调用级常量
  const colonSeparator = space ? ': ' : ':';

  // indent 为本节点缩进串（根节点由 space 决定）。传缩进串而非层级：indent(level + 1)
  // 恒等于 indent(level) + space，于是每节点只需一次 O(1) 拼接——既不需要 space.repeat(level)，
  // 也就不需要缓存它。compact 模式下 space 为空串，拼接恒得空串，无需分支。
  function stringify(parent: any, key: string, node: any, indent: string): string | undefined {
    if (node && typeof node.toJSON === 'function') {
      node = node.toJSON(key);
    }

    node = replacer.call(parent, parent, key, node);
    if (node === undefined) return;

    if (typeof node !== 'object' || node === null) return JSON.stringify(node);

    if (seen.has(node)) {
      if (cycles) return JSON.stringify('__cycle__');
      throw new TypeError('Converting circular structure to JSON');
    }

    // 子节点缩进 = 本层缩进 + 一级缩进；同一值同时用作成员的缩进前缀
    const childIndent = indent + space;

    if (Array.isArray(node)) {
      seen.add(node);
      const out: string[] = [];
      for (let i = 0; i < node.length; i++) {
        // key 恒为字符串（对齐原生 JSON.stringify）：数组元素传索引字符串，而非数字
        const item = stringify(node, String(i), node[i], childIndent);
        out.push(childIndent + (item === undefined ? 'null' : item));
      }
      seen.delete(node);
      return wrap(out, '[', ']', indent);
    }

    seen.add(node);

    const keys = Object.keys(node);
    const comparer = cmp ? cmp(node) : void 0;
    comparer ? keys.sort(comparer) : keys.sort();

    const out: string[] = [];
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const value = stringify(node, key, node[key], childIndent);

      if (value === undefined) continue;

      const keyValue = JSON.stringify(key) + colonSeparator + value;
      out.push(childIndent + keyValue);
    }

    seen.delete(node);

    return wrap(out, '{', '}', indent);
  }

  // 根节点缩进：pretty-print 下首行换行，compact 下为空串（等价于原 level = 0 的缩进串）
  return stringify({ '': obj }, '', obj, space ? '\n' : '');
}

export { stableStringify };
export type { CmpFunc, ReplacerFunc, StableStringifyOptions };

export default stableStringify;
