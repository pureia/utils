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
  /** 缩进，对齐原生 JSON.stringify：数字截断并钳制到 [0, 10]（负数/NaN 视为无缩进），字符串仅取前 10 个码元；装箱 Number/String 按拆箱后的值处理 */
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

/** Number / String / Boolean 包装对象的内部槽值即其 `valueOf()` 结果 */
const unwrapBoxedValue = (node: object): unknown => (node as { valueOf(): unknown }).valueOf();

/**
 * 装箱原始值标签 → 拆箱函数（原生在 replacer 之后按内部槽拆箱，故此处同样按内部槽还原）。
 *
 * 标签经 `Object.prototype.toString` 取得而非 `instanceof`：后者跨 realm 失效，而内部槽判定与
 * realm 无关。BigInt 包装没有对应的全局构造器，只能经 `BigInt.prototype.valueOf` 取其内部槽。
 */
const BOXED_UNWRAPPERS: Record<string, (node: object) => unknown> = {
  '[object Number]': unwrapBoxedValue,
  '[object String]': unwrapBoxedValue,
  '[object Boolean]': unwrapBoxedValue,
  '[object BigInt]': node => BigInt.prototype.valueOf.call(node),
};

/**
 * 按内部槽拆箱装箱原始值；非装箱对象原样返回。
 *
 * 先做一次廉价原型筛选：原型为 `Object.prototype` / `Array.prototype` / `null` 者必非装箱对象，
 * 直接返回——普通对象图因而只多一次原型读取；仅可疑原型才做一次精确标签判定。
 *
 * @param node - 待判定的对象（调用方保证非 null）
 * @returns 拆箱后的原始值，或原对象
 */
function unbox(node: object): unknown {
  const proto = Object.getPrototypeOf(node);
  if (proto === Object.prototype || proto === Array.prototype || proto === null) return node;

  const unwrap = BOXED_UNWRAPPERS[Object.prototype.toString.call(node)];
  return unwrap ? unwrap(node) : node;
}

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
    // 原生先按内部槽拆箱装箱的 Number / String 再归一（Boolean 包装与其他对象不拆箱，即不缩进）。
    // 类型上 space 是 string | number，装箱形态只可能来自未受类型约束的调用方，故此处按 unknown 处理
    const raw: unknown = opts.space;
    const value = typeof raw === 'object' && raw !== null ? unbox(raw) : raw;
    if (typeof value === 'number') {
      const n = Math.trunc(value);
      space = n >= 1 ? ' '.repeat(Math.min(10, n)) : '';
    }
    else if (typeof value === 'string') {
      space = value.slice(0, 10);
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
 * 确定性版本的 `JSON.stringify`：对象键按 UTF-16 码元排序，相同内容恒产出相同字符串。
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
    // toJSON 只在 Object（含函数）与 BigInt 上查找——对齐原生规范：GetV 仅对这两类进行。
    // 真值原始值（字符串/数字/布尔）因此不再被查找；0n 与 1n 也不会再一查一不查。
    // 属性只读取一次并以 call 显式绑定 this：accessor 形态的 toJSON 不会因二次读取被触发两遍。
    const nodeType = typeof node;
    if ((node !== null && (nodeType === 'object' || nodeType === 'function')) || nodeType === 'bigint') {
      const toJSON = node.toJSON;
      if (typeof toJSON === 'function') node = toJSON.call(node, key);
    }

    node = replacer.call(parent, parent, key, node);
    if (node === undefined) return;

    if (typeof node !== 'object' || node === null) return JSON.stringify(node);

    // 装箱原始值按内部槽拆箱（对齐原生：位于 replacer 之后、容器分派之前）。
    // 数组必非装箱对象，跳过判定以免为数组多付一次原型读取；拆箱可能还原为原始值，故需重判。
    if (!Array.isArray(node)) {
      node = unbox(node);
      if (typeof node !== 'object' || node === null) return JSON.stringify(node);
    }

    if (seen.has(node)) {
      if (cycles) return JSON.stringify('__cycle__');
      throw new TypeError('Converting circular structure to JSON');
    }

    // 子节点缩进 = 本层缩进 + 一级缩进；同一值同时用作成员的缩进前缀
    const childIndent = indent + space;

    // 环保护的进入-离开必须成对：进入点与离开点各只有一处，新增容器分支也不会遗漏配对的
    // seen.delete（原先两个分支各自 add/delete 一遍）。不使用 try/finally：抛错会中止整个调用，
    // 而 seen 是调用级状态，故无需在异常路径上回滚。
    seen.add(node);

    let result: string;

    if (Array.isArray(node)) {
      const out: string[] = [];
      for (let i = 0; i < node.length; i++) {
        // key 恒为字符串（对齐原生 JSON.stringify）：数组元素传索引字符串，而非数字
        const item = stringify(node, String(i), node[i], childIndent);
        out.push(childIndent + (item === undefined ? 'null' : item));
      }
      result = wrap(out, '[', ']', indent);
    }
    else {
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

      result = wrap(out, '{', '}', indent);
    }

    seen.delete(node);
    return result;
  }

  // 根节点缩进：pretty-print 下首行换行，compact 下为空串（等价于原 level = 0 的缩进串）
  return stringify({ '': obj }, '', obj, space ? '\n' : '');
}

export { stableStringify };
export type { CmpFunc, ReplacerFunc, StableStringifyOptions };

export default stableStringify;
