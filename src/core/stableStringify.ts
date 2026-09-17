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

/** 自定义 key 排序比较函数：接收 `{ key, value }` 对；第三个参数恒被传入按 key 取值的 getter（类型上仍标为可选，以便两参比较器直接赋值），返回负数/0/正数决定排序 */
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
  /** 缩进，对齐原生 JSON.stringify：数字截断并钳制到 [0, 10]（负数/NaN 视为无缩进），字符串仅取前 10 个码元，装箱 Number/String 按拆箱后的值处理，其余类型（boolean/对象等）按无缩进 */
  space?: string | number;
  /** 自定义 key 排序比较函数；也可直接传比较函数作为第二个参数 */
  cmp?: CmpFunc;
  /** 过滤/转换函数，返回 `undefined` 跳过该属性 */
  replacer?: ReplacerFunc;
  /** 将循环引用序列化为 `"__cycle__"` 而非抛错；严格判定（`=== true`），其余取值含真值（`1`/`'yes'` 等）一律视为 false，默认 false */
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
 * 品牌判定原语：在模块加载时捕获——`Object` 与 `Object.prototype` 上的方法可被调用方改写，
 * 捕获后判定不受其影响（与下方槽检查方法同理）
 */
const getPrototype = Object.getPrototypeOf;
const objectToString = Object.prototype.toString;

/** Number 包装的槽检查：`Number.prototype.valueOf` 要求具备 [[NumberData]]，无槽即抛 TypeError */
const boxedNumberSlot = (node: object): unknown => Number.prototype.valueOf.call(node);

/** String 包装的槽检查：`String.prototype.valueOf` 要求具备 [[StringData]]，无槽即抛 TypeError */
const boxedStringSlot = (node: object): unknown => String.prototype.valueOf.call(node);

/** Boolean 包装的槽读取：`Boolean.prototype.valueOf` 要求具备 [[BooleanData]]，无槽即抛 TypeError */
const boxedBooleanSlot = (node: object): unknown => Boolean.prototype.valueOf.call(node);

/** BigInt 包装的槽读取：BigInt 无对应全局构造器，只能经 `BigInt.prototype.valueOf` 取值 */
const boxedBigIntSlot = (node: object): unknown => BigInt.prototype.valueOf.call(node);

/** Number 包装取值：按规范用 `ToNumber`（沿可覆写的 valueOf → toString 求值） */
const boxedNumberValue = (node: object): unknown => Number(node);

/** String 包装取值：按规范用 `ToString`（沿可覆写的 toString → valueOf 求值） */
const boxedStringValue = (node: object): unknown => String(node);

/**
 * 装箱原始值标签 → { 槽检查, 取值 }。
 *
 * 取值按原生规范分两类：Number 用 `ToNumber`、String 用 `ToString`——二者都会沿可覆写的
 * `valueOf`/`toString` 求值，故须在槽检查之后另取一次；Boolean 与 BigInt 则直接读内部槽、
 * 槽值即最终值，因此不提供 `value`，由 `unbox` 复用槽检查的返回值（免去同一函数被调用两次）。
 */
interface BoxedKind {
  /** 槽检查：无对应内部槽时抛 TypeError（userland 唯一不可伪造的品牌检查） */
  slot: (node: object) => unknown;
  /** 取值：仅在规范要求「先查槽、再按 ToNumber/ToString 另取」时提供；Boolean/BigInt 的槽值即最终值 */
  value?: (node: object) => unknown;
}

const NUMBER_KIND: BoxedKind = { slot: boxedNumberSlot, value: boxedNumberValue };
const STRING_KIND: BoxedKind = { slot: boxedStringSlot, value: boxedStringValue };
const BOOLEAN_KIND: BoxedKind = { slot: boxedBooleanSlot };
const BIGINT_KIND: BoxedKind = { slot: boxedBigIntSlot };

/**
 * 标签 → 槽种类：只在链上不存在 `Symbol.toStringTag` 时用于挑候选——此时 `Object.prototype.toString`
 * 的标签必然取自内部槽（规范：无该属性则回落到 builtinTag），既不可伪造，读取也不会触发用户代码。
 */
const BOXED_KINDS: Record<string, BoxedKind> = {
  '[object Number]': NUMBER_KIND,
  '[object String]': STRING_KIND,
  '[object Boolean]': BOOLEAN_KIND,
  '[object BigInt]': BIGINT_KIND,
};

/** 包装原型 → 槽种类：链上存在 `Symbol.toStringTag` 时改由原型链挑候选（四类内部槽只能随对应包装原型进入原型链） */
const BOXED_BY_PROTO = new Map<object, BoxedKind>([
  [Number.prototype, NUMBER_KIND],
  [String.prototype, STRING_KIND],
  [Boolean.prototype, BOOLEAN_KIND],
  [BigInt.prototype, BIGINT_KIND],
]);

/** 四类槽种类的固定探测顺序：与 BOXED_BY_PROTO 同源，避免两处清单漂移 */
const BOXED_KIND_LIST: readonly BoxedKind[] = [...BOXED_BY_PROTO.values()];

/** 无对应内部槽的哨兵：四类槽的取值恒为原始值（Number/String 经 ToNumber/ToString、Boolean/BigInt 读槽），不可能等于它 */
const NO_SLOT = Symbol('noSlot');

/**
 * 读取槽值：无对应内部槽时返回 `NO_SLOT`。
 *
 * **取值（`kind.value`）刻意留在 try 之外**：包装对象被改写的 `valueOf` / `toString` 抛错应向
 * 调用方传播（与原生一致），不能被这里的 catch 吞掉而误判为「非装箱对象」。
 *
 * @param kind - 候选槽种类
 * @param node - 待取值的对象（调用方保证非 null）
 * @returns 拆箱后的原始值，或 `NO_SLOT`
 */
function readSlotValue(kind: BoxedKind, node: object): unknown {
  let slotValue: unknown;
  try {
    slotValue = kind.slot(node);
  }
  catch {
    return NO_SLOT;
  }

  return kind.value ? kind.value(node) : slotValue;
}

/**
 * 沿原型链挑候选槽种类：返回链上第一个包装原型对应的种类，链上没有包装原型则返回 undefined。
 *
 * 只用于「标签不可读」的场合。原型只是**线索**而非判定——链上有包装原型不等于真有对应内部槽
 * （如 `Object.create(Number.prototype)`），故调用方仍须做槽检查。
 *
 * 走到 `Object.prototype` 即可停：它与其后的 `null` 都不可能是包装原型，而任何包装原型都必在
 * 链上更早出现（省去「类实例 / `Map` 等负例」的最后一跳）。
 *
 * @param node - 待判定的对象（调用方保证非 null）
 * @returns 候选槽种类，或 undefined
 */
function kindByProtoChain(node: object): BoxedKind | undefined {
  let proto = getPrototype(node);
  while (proto !== null && proto !== Object.prototype) {
    const kind = BOXED_BY_PROTO.get(proto);
    if (kind) return kind;
    proto = getPrototype(proto);
  }
  return undefined;
}

/**
 * 链上带 `Symbol.toStringTag` 时的拆箱：不读该属性，改由原型链与内部槽判定。
 *
 * 先试原型链命中的那一类（常态一次命中）；原型被改写成另一类包装原型时，实际内部槽才是事实，
 * 故再兜底探测其余三类——槽检查不可伪造，误判方向只可能是「漏探测」而非「误拆箱」。
 *
 * @param node - 待判定的对象（调用方保证非 null）
 * @returns 拆箱后的原始值，或原对象
 */
function unboxByProtoChain(node: object): unknown {
  const hinted = kindByProtoChain(node);
  if (!hinted) return node;

  const hit = readSlotValue(hinted, node);
  if (hit !== NO_SLOT) return hit;

  for (let i = 0; i < BOXED_KIND_LIST.length; i++) {
    const kind = BOXED_KIND_LIST[i];
    if (kind === hinted) continue;
    const value = readSlotValue(kind, node);
    if (value !== NO_SLOT) return value;
  }
  return node;
}

/**
 * 拆箱装箱原始值；非装箱对象原样返回。
 *
 * 判定分三步——**原型直取**、**挑候选**、**确认槽**：
 * - 原型即四个包装原型之一：直接做该类的槽检查（槽才是事实，标签给不出别的结论），命中即返回；
 * - 链上不存在 `Symbol.toStringTag`：`Object.prototype.toString` 的标签必然取自内部槽（规范：
 *   无该属性则回落到 builtinTag），不可伪造，可直接用作候选；此路径不触发任何用户代码。
 * - 链上存在 `Symbol.toStringTag`：**一律不读该属性**——它可能是伪造的值，也可能是抛错或有副作用
 *   的 getter，而原生根本不读它（读一次即多一次可观察行为）；改由原型链定位候选（见 `unboxByProtoChain`）。
 *
 * 候选到此只是「可能」，一律再用真正的槽检查确认——对应原型方法在缺少内部槽时抛 `TypeError`，
 * 这是 userland 唯一不可伪造的品牌检查。用内部槽而非 `instanceof`，因为后者跨 realm 失效，
 * 且可被 `Symbol.hasInstance` 改写。
 *
 * 先做一次廉价原型筛选：原型为 `Object.prototype` / `Array.prototype` / `null` 者按常规对象
 * 处理、直接返回——普通对象图与数组因而只多一次原型读取。
 *
 * 已知边界（userland 只能按原型与标签推断，原生按内部槽判定；以下三类与原生不一致）：
 * - 原型被重置为 `Object.prototype` / `Array.prototype` / `null` 的包装对象被上述筛选跳过。原生仍会
 *   拆箱，但取值沿重置后原型上的 `valueOf` / `toString`（重置为 `Object.prototype` 时两者都取不到
 *   原始值，最终得 `null`）；
 * - 原型被换成**链上不含四个包装原型之一**（跨 realm 的包装原型不在其列）**、且带
 *   `Symbol.toStringTag`** 的包装对象：标签不可读、原型链也无线索，只能按普通对象序列化；
 * - **BigInt 包装**没有内置标签——`Object.prototype.toString` 的 builtinTag 不含 `[[BigIntData]]`，
 *   它的 `[object BigInt]` 来自 `BigInt.prototype[Symbol.toStringTag]`——故原型一旦被换出
 *   `BigInt.prototype`，即使链上无标签也无从识别，只能按普通对象序列化（原生抛 `TypeError`）。
 *   Number / String / Boolean 包装不受此限：三者都有内置标签。
 * 另有一处与原生不同的可观察行为：`Symbol.toStringTag in node` 会让 Proxy 收到一次 `has` 陷阱
 * 调用（原生不调用该陷阱）；陷阱抛错时异常向调用方传播。
 *
 * @param node - 待判定的对象（调用方保证非 null）
 * @returns 拆箱后的原始值，或原对象
 */
function unbox(node: object): unknown {
  const proto = getPrototype(node);
  if (proto === Object.prototype || proto === Array.prototype || proto === null) return node;

  // 原型即某个包装原型：槽检查直接给答案，标签给不出别的结论（槽才是事实）。这也是装箱对象最常见的
  // 形态（含子类以外的全部同 realm 包装对象），故优先于标签判定，省掉一次标签读取
  const byProto = BOXED_BY_PROTO.get(proto);
  if (byProto) {
    const value = readSlotValue(byProto, node);
    if (value !== NO_SLOT) return value;
    // 原型被改写成另一类包装原型：内部槽与原型不符，落到下面的通用判定
  }

  // 链上无标签：Object.prototype.toString 的标签必出自内部槽（规范：无该属性则回落到 builtinTag），
  // 不可伪造，可直接用作候选；此路径不触发任何用户代码
  if (!(Symbol.toStringTag in node)) {
    const kind = BOXED_KINDS[objectToString.call(node)];
    return kind ? readSlotValue(kind, node) : node;
  }

  return unboxByProtoChain(node);
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

  // 归一规则见 StableStringifyOptions#space，此处只记两点「为什么」：
  // - 数字先截断再钳到 [0, 10]：Infinity / 超大值若直接交给 repeat 会挂死或吃满内存
  // - 装箱 Number / String 须先拆箱再归一——原生即按内部槽还原（Boolean 包装与其他对象不拆箱，
  //   也即不缩进）；space 类型上是 string | number，装箱形态只可能来自未受类型约束的调用方，
  //   故此处按 unknown 处理
  let space = '';
  if (isObj && opts.space !== undefined) {
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

  // cmp 非函数时静默忽略（对齐原生忽略非函数 replacer 的姿态）：此前非函数真值会被直接当作
  // 比较器使用，并在 sort 内部抛 "cmpOpt is not a function"——且只有存在 ≥2 个键的节点才会走到
  // 排序，故表现为「多数输入正常、偶发抛错」这种难以归因的形态。
  const cmpOpt = typeof opts === 'function' ? opts : (isObj && typeof opts.cmp === 'function' ? opts.cmp : void 0);
  // 包装为按节点调用的比较器：每次比较都向 cmp 传入 { key, value } 对（取自当前节点）与按 key 取值的
  // getter。**getter 无条件注入**——原先按 `Function.length > 2` 嗅探调用方是否声明了第三个参数，
  // 而第三参带默认值或 rest 时 length 停在 2，这类比较器会静默拿不到 getter 导致排序走偏；
  // 两参比较器只是多收一个被忽略的实参。getter 每节点构造一次并复用（而非每次比较新建）。
  const cmp: NodeComparator | undefined = cmpOpt
    ? (node: Record<string, any>) => {
        const getter = { get: (k: string) => node[k] };
        return (a: string, b: string) =>
          cmpOpt(
            { key: a, value: node[a] },
            { key: b, value: node[b] },
            getter
          );
      }
    : void 0;

  return { space, cycles: isObj && opts.cycles === true, replacer, cmp };
}

/** 容器括号对：以成对常量提供，使「开闭括号配错」在调用点不可表达 */
const BRACKETS: Record<'list' | 'map', readonly [string, string]> = {
  list: ['[', ']'],
  map: ['{', '}'],
};

/**
 * 包裹已序列化的成员，产出容器字面量。
 *
 * 空容器恒输出紧凑括号（与原生 `JSON.stringify` 一致，即使 pretty-print 模式）；
 * 否则逐项以逗号连接、以本层缩进收尾。括号成对传入，既免去按 `'[]' | '{}'` 标签二次解码
 * 同一判别，又保留标签原本自带的「开闭括号不可配错」约束。
 *
 * @param out - 已各自带缩进前缀的成员字符串
 * @param brackets - 成对的 [开括号, 闭括号]
 * @param indent - 本层缩进（仅非空容器使用）
 */
function wrap(out: string[], brackets: readonly [string, string], indent: string): string {
  return out.length === 0
    ? brackets[0] + brackets[1]
    : brackets[0] + out.join(',') + indent + brackets[1];
}

/**
 * 确定性版本的 `JSON.stringify`：对象键按 UTF-16 码元排序，相同内容恒产出相同字符串。
 *
 * 与原生 `JSON.stringify` 的可观察差异：
 * - `replacer` 签名为 `(parent, key, value)`，第一个参数是父对象（替代原生的 `this` 绑定）
 * - `cycles: true` 时将循环引用序列化为 `"__cycle__"` 而非抛错
 * - 类数组整数键（如 `"2"`/`"10"`）不按数值优先排序（原生会将其排在最前），
 *   与其余键统一按码元序排序——确定性不受影响，但跨工具哈希比对时需注意
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

    // 容器种类判定一次即可：unbox 对真包装对象一律返回原始值（被下一行 return 拦下），
    // 否则原样返回同一对象，故该结果在后面的容器分派处依然成立
    const isArray = Array.isArray(node);

    // 装箱原始值按内部槽拆箱（对齐原生：位于 replacer 之后、容器分派之前）。
    // 数组必非装箱对象，跳过判定以免为数组多付一次原型读取；拆箱可能还原为原始值，故需重判。
    if (!isArray) {
      node = unbox(node);
      if (typeof node !== 'object' || node === null) return JSON.stringify(node);
    }

    if (seen.has(node)) {
      if (cycles) return JSON.stringify('__cycle__');
      throw new TypeError('Converting circular structure to JSON');
    }

    // 子节点缩进 = 本层缩进 + 一级缩进；同一值同时用作成员的缩进前缀
    const childIndent = indent + space;

    // 循环引用防护的进入-离开必须成对：进入点与离开点各只有一处，新增容器分支也不会遗漏配对的
    // seen.delete（原先两个分支各自 add/delete 一遍）。不使用 try/finally：抛错会中止整个调用，
    // 而 seen 是调用级状态，故无需在异常路径上回滚。
    seen.add(node);

    let result: string;

    if (isArray) {
      // 长度在循环前快照一次（对齐原生的 LengthOfArrayLike）：遍历期间对数组的读写不再改变迭代次数。
      // 同时把每轮的 length 属性读取降为一次
      const length = node.length;
      const out: string[] = [];
      for (let i = 0; i < length; i++) {
        // key 恒为字符串（对齐原生 JSON.stringify）：数组元素传索引字符串，而非数字
        const item = stringify(node, String(i), node[i], childIndent);
        out.push(childIndent + (item === undefined ? 'null' : item));
      }
      result = wrap(out, BRACKETS.list, indent);
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

      result = wrap(out, BRACKETS.map, indent);
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
