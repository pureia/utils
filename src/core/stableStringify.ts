/** 自定义 key 排序比较函数：接收 `{ key, value }` 对；第三个参数恒被传入按 key 取值的 getter（类型上仍标为可选，以便两参比较器直接赋值），返回负数/0/正数决定排序 */
type CmpFunc = (
  a: { key: string; value: any },
  b: { key: string; value: any },
  getter?: { get: (key: string) => any }
) => number;

/**
 * 过滤/转换函数：比原生 `JSON.stringify` 的 replacer **多一个前导 `parent` 参数**——原生是
 * `(key, value)` 加 `this` 绑定父对象，此处 `this` 与 `parent` 都是父对象；`key` 恒为字符串
 * （数组元素即索引字符串），返回 `undefined` 时跳过该属性。
 *
 * 照原生习惯写两参会**静默错位**（第一参收到父对象、第二参收到 key，不报错），而少写形参在类型上
 * 合法、编译期拦不住。此处只声明、不做运行期嗅探——`Function.length` 对带默认值或 rest 的写法不可靠
 * （本文件对 `cmp` 已因此废掉该嗅探）。
 */
type ReplacerFunc = (this: any, parent: any, key: string, value: any) => any;

/**
 * `stableStringify` 选项；未提供的字段按原生 `JSON.stringify` 的默认语义处理。
 */
interface StableStringifyOptions {
  /** 缩进，对齐原生 JSON.stringify：数字截断并钳制到 [0, 10]（负数/NaN 视为无缩进），字符串仅取前 10 个码元，装箱 Number/String 按拆箱后的值处理，其余类型（boolean/对象等）按无缩进。**类型只收 `string | number`**（与原生 lib 的类型一致）：装箱形态是运行期兼容、供未受类型约束的调用方使用，TS 调用方需自行断言 */
  space?: string | number;
  /** 自定义 key 排序比较函数；也可直接传比较函数作为第二个参数 */
  cmp?: CmpFunc;
  /** 过滤/转换函数，返回 `undefined` 跳过该属性 */
  replacer?: ReplacerFunc;
  /** 将循环引用序列化为 `"__cycle__"` 而非抛错；严格判定（`=== true`），其余取值含真值（`1`/`'yes'` 等）一律视为 false，默认 false */
  cycles?: boolean;
}

/**
 * 判定与取值所用的原语：在模块加载时捕获——`Object` / `Object.prototype` 上的方法、四个包装原型上的
 * `valueOf`，以及 `Number` / `String` / `Symbol.toStringTag` 都可被调用方改写或替换，
 * 捕获后判定与取值都不受其影响。
 *
 * **捕获的只是「判定与取值所用的函数对象」**：`value` 仍沿当时的原型链求值（见 `BoxedKind#value`），
 * 故「包装对象被改写 `valueOf`/`toString` 会抛错」这一原生语义不受影响。
 */
const getPrototype = Object.getPrototypeOf;
const objectToString = Object.prototype.toString;
const toStringTag = Symbol.toStringTag;
const numberCtor = Number;
const stringCtor = String;
const numberValueOf = Number.prototype.valueOf;
const stringValueOf = String.prototype.valueOf;
const booleanValueOf = Boolean.prototype.valueOf;
const bigIntValueOf = BigInt.prototype.valueOf;

/**
 * 装箱原始值的一类：标签、包装原型、槽检查，以及（规范要求另取时的）取值。
 *
 * 取值按原生规范分两类：Number 用 `ToNumber`、String 用 `ToString`——二者都会沿可覆写的
 * `valueOf`/`toString` 求值，故须在槽检查之后另取一次；Boolean 与 BigInt 则直接读内部槽、
 * 槽值即最终值，因此不提供 `value`，由 `readSlotValue` 复用槽检查的返回值（免去同一函数被调用两次）。
 */
interface BoxedKind {
  /** `Object.prototype.toString` 在链上无 `Symbol.toStringTag` 时给出的标签（BigInt 的 `[object BigInt]` 来自其原型上的该属性，不是内置标签） */
  label: string;
  /** 对应包装原型：链上存在 `Symbol.toStringTag` 时据此挑候选（四类内部槽只能随对应包装原型进入原型链） */
  proto: object;
  /** 槽检查：无对应内部槽时抛 TypeError（userland 唯一不可伪造的品牌检查） */
  slot: (node: object) => unknown;
  /** 取值：仅在规范要求「先查槽、再按 ToNumber/ToString 另取」时提供；Boolean/BigInt 的槽值即最终值 */
  value?: (node: object) => unknown;
}

/**
 * 四类装箱槽的**唯一清单**：标签表、原型表与固定探测顺序都由此派生，增删一类只动这一处。
 *
 * `label` 只在链上不存在 `Symbol.toStringTag` 时用于挑候选——此时 `Object.prototype.toString`
 * 的标签必然取自内部槽（规范：无该属性则回落到 builtinTag），既不可伪造，读取也不会触发用户代码。
 */
const BOXED_KINDS: readonly BoxedKind[] = [
  { label: '[object Number]', proto: Number.prototype, slot: (node) => numberValueOf.call(node), value: (node) => numberCtor(node) },
  { label: '[object String]', proto: String.prototype, slot: (node) => stringValueOf.call(node), value: (node) => stringCtor(node) },
  { label: '[object Boolean]', proto: Boolean.prototype, slot: (node) => booleanValueOf.call(node) },
  { label: '[object BigInt]', proto: BigInt.prototype, slot: (node) => bigIntValueOf.call(node) },
];

/** 标签 → 槽种类（链上无 `Symbol.toStringTag` 时挑候选用，见 `BoxedKind#label`） */
const KIND_BY_LABEL = new Map<string, BoxedKind>(BOXED_KINDS.map((kind): [string, BoxedKind] => [kind.label, kind]));

/** 包装原型 → 槽种类（链上有 `Symbol.toStringTag` 时挑候选用，见 `BoxedKind#proto`） */
const KIND_BY_PROTO = new Map<object, BoxedKind>(BOXED_KINDS.map((kind): [object, BoxedKind] => [kind.proto, kind]));

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
    const kind = KIND_BY_PROTO.get(proto);
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

  for (let i = 0; i < BOXED_KINDS.length; i++) {
    const kind = BOXED_KINDS[i];
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
  const byProto = KIND_BY_PROTO.get(proto);
  if (byProto) {
    const value = readSlotValue(byProto, node);
    if (value !== NO_SLOT) return value;
    // 原型被改写成另一类包装原型：内部槽与原型不符，落到下面的通用判定
  }

  // 链上无标签：Object.prototype.toString 的标签必出自内部槽（规范：无该属性则回落到 builtinTag），
  // 不可伪造，可直接用作候选；此路径不触发任何用户代码
  if (!(toStringTag in node)) {
    const kind = KIND_BY_LABEL.get(objectToString.call(node));
    return kind ? readSlotValue(kind, node) : node;
  }

  return unboxByProtoChain(node);
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
 * 归一 `space`：产出每层之间的缩进串（无缩进时为空串）。
 *
 * 规则见 `StableStringifyOptions#space`，此处只记两点「为什么」：
 * - 数字先截断再钳到 [0, 10]：Infinity / 超大值若直接交给 repeat 会挂死或吃满内存
 * - 装箱 Number / String 须先拆箱再归一——原生即按内部槽还原（Boolean 包装与其他对象不拆箱，
 *   也即不缩进）；`space` 类型上是 string | number，装箱形态只可能来自未受类型约束的调用方，
 *   故入参按 unknown 处理
 *
 * @param raw - 调用方给出的 `space`（调用方保证非 undefined）
 * @returns 缩进串
 */
function normalizeSpace(raw: unknown): string {
  const value = typeof raw === 'object' && raw !== null ? unbox(raw) : raw;
  if (typeof value === 'number') {
    const n = Math.trunc(value);
    return n >= 1 ? ' '.repeat(Math.min(10, n)) : '';
  }
  return typeof value === 'string' ? value.slice(0, 10) : '';
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

  const space = isObj && opts.space !== undefined ? normalizeSpace(opts.space) : '';

  const replacer = isObj && typeof opts.replacer === 'function' ? opts.replacer : identityReplacer;

  // cmp 非函数时静默忽略，姿态对齐原生忽略非函数 replacer
  const cmpOpt = typeof opts === 'function' ? opts : (isObj && typeof opts.cmp === 'function' ? opts.cmp : void 0);
  // 包装为按节点调用的比较器：每次比较都向 cmp 传入 { key, value } 对（取自当前节点）与按 key 取值的
  // getter。**getter 无条件注入**——不按 `Function.length` 嗅探：第三参带默认值或 rest 时 length 停在 2，
  // 嗅探会让这类比较器静默拿不到 getter；两参比较器只是多收一个被忽略的实参。
  // getter 每节点构造一次并复用。比较器每次比较都重新取 `node[a]` / `node[b]`（访问器属性因此会被
  // 多次求值，且每次比较新建两个 { key, value } 对象）——这是既有行为，改动它会变更可观察语义。
  const cmp: NodeComparator | undefined = cmpOpt
    ? (node: Record<string, any>) => {
        const getter = { get: (k: string) => node[k] };
        return (a: string, b: string) => cmpOpt({ key: a, value: node[a] }, { key: b, value: node[b] }, getter);
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
  return out.length === 0 ? brackets[0] + brackets[1] : brackets[0] + out.join(',') + indent + brackets[1];
}

/** 报错路径上读取原型自有属性的原语：同样在加载时捕获（避免报错途中受被改写的全局影响） */
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

/** 本层边在报错文本里的写法：数组元素为 `index N`，对象属性为 `property 'k'`，空串键记作 `<anonymous>` */
function edgeLabel(from: object, key: string): string {
  return Array.isArray(from) ? `index ${key}` : key === '' ? '<anonymous>' : `property '${key}'`;
}

/**
 * 构造器名（仅供报错文本）：按 V8 的口径沿原型链找**自有 data 属性** `constructor`，取其函数的 `name`。
 *
 * getter 一律不触发、非函数值继续上行，走到链尾回落 `'Object'`（`Object.create(null)` 亦然）。
 *
 * 已知与 V8 不一致（V8 读的是函数内部名，userland 取不到）：`name` 被改写为其他值时此处读到改写后的值；
 * bound 函数的 `name` 形如 `bound X`，V8 会跳过它继续上行。
 *
 * @param node - 环上的容器节点（调用方保证非 null）
 * @returns 构造器名，取不到时为 `'Object'`
 */
function constructorName(node: object): string {
  let proto = getPrototype(node);
  while (proto !== null) {
    const descriptor = getOwnPropertyDescriptor(proto, 'constructor');
    if (descriptor && 'value' in descriptor && typeof descriptor.value === 'function') {
      const name: unknown = (descriptor.value as { name?: unknown }).name;
      if (typeof name === 'string' && name !== '') return name;
    }
    proto = getPrototype(proto);
  }
  return 'Object';
}

/**
 * 循环引用的报错文本：按 V8（Node）口径渲染环上的路径——首行指明被重复进入的节点，
 * 中间每跳一行，末行指明闭合的那条边。非 V8 引擎（如 uni-app 的 JSCore）原生措辞不同，此处不对齐它们。
 *
 * @param path - 调用级路径节点集（Set，迭代顺序即 DFS 栈序）
 * @param keys - 与 `path` 插入顺序一一对应的边 key 数组
 * @param repeated - 被重复进入的节点（环的起点）
 * @param parent - 当前节点的父容器（闭合边的来源）
 * @param key - 当前节点在父容器里的 key（闭合边）
 * @returns 报错信息
 */
function circularMessage(path: Set<object>, keys: string[], repeated: object, parent: object, key: string): string {
  const lines = [
    'Converting circular structure to JSON',
    `    --> starting at object with constructor '${constructorName(repeated)}'`,
  ];

  let index = 0;
  let reached = false;
  let previous: object = repeated;
  for (const node of path) {
    if (!reached) {
      index++;
      if (node === repeated) reached = true;
      continue;
    }
    lines.push(`    |     ${edgeLabel(previous, keys[index])} -> object with constructor '${constructorName(node)}'`);
    previous = node;
    index++;
  }

  lines.push(`    --- ${edgeLabel(parent, key)} closes the circle`);
  return lines.join('\n');
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
 * @throws {TypeError} 遇循环引用且 `cycles` 未启用时；文本按 V8（Node）口径，含 `--> starting at …` 路径详情
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

  // 循环引用防护：成员判定仍用 Set（热路径与改动前一致），另外用一个与插入顺序一一对应的 key 数组
  // 记录「进入该节点时那条边」的 key（DFS 下进出都是栈尾，push/pop 即配对）。仅在抛出时才需要这份
  // 路径信息——用 Map 直接存 key 会拖慢热路径（实测深嵌套 +14% / 大数组 +12%），故拆成两半
  const onPath = new Set<object>();
  const pathKeys: string[] = [];

  // 分隔符仅由 space 决定，提升为调用级常量
  const colonSeparator = space ? ': ' : ':';

  // indent 为本节点缩进串（根节点由 space 决定）。传缩进串而非层级：indent(level + 1)
  // 恒等于 indent(level) + space，于是每节点只需一次 O(1) 拼接。compact 模式下 space 为空串，
  // 拼接恒得空串，无需分支。
  function stringify(parent: any, key: string, node: any, indent: string): string | undefined {
    // toJSON 只在 Object（含函数）与 BigInt 上查找——对齐原生规范：GetV 仅对这两类进行；
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

    if (onPath.has(node)) {
      if (cycles) return JSON.stringify('__cycle__');
      throw new TypeError(circularMessage(onPath, pathKeys, node, parent, key));
    }

    // 子节点缩进 = 本层缩进 + 一级缩进；同一值同时用作成员的缩进前缀
    const childIndent = indent + space;

    // 循环引用防护的进入-离开必须成对：进入点与离开点各只有一处，新增容器分支也不会遗漏配对的
    // onPath.delete。不使用 try/finally：抛错会中止整个调用，而 onPath 是调用级状态，
    // 故无需在异常路径上回滚。
    onPath.add(node);
    pathKeys.push(key);

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

    onPath.delete(node);
    pathKeys.pop();
    return result;
  }

  // 根节点缩进：pretty-print 下首行换行，compact 下为空串
  return stringify({ '': obj }, '', obj, space ? '\n' : '');
}

export { stableStringify };
export type { CmpFunc, ReplacerFunc, StableStringifyOptions };

export default stableStringify;
