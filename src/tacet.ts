/**
 * The runtime. Two marks, `live` and `deep`, and the functions both the
 * decorator form and the comment-tag form call: `installField` and
 * `installGetter`. Everything here sits on six Vue functions.
 */
import {computed, markRaw, shallowReactive, shallowRef, toRaw, type ComputedRef} from "vue";

export type Mark = "live" | "deep";

// ---------------------------------------------------------------------------
// deep: plain objects, arrays, Maps and Sets are followed all the way down.
// A class instance is never entered: its own marks decide its surface.
// ---------------------------------------------------------------------------

const deepProxies = new WeakMap<object, object>();
const innerOf = new WeakMap<object, object>();

function isPlainData(value: unknown): value is object {
    if (typeof value !== "object" || value === null) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null || proto === Array.prototype || proto === Map.prototype || proto === Set.prototype;
}

/** Wraps plain data so the screen follows it; returns anything else as it is. */
export function toDeep<T>(value: T): T {
    if (!isPlainData(value)) return value;
    const raw = toRaw(value) as object;
    const known = deepProxies.get(raw);
    if (known !== undefined) return known as T;
    const inner = shallowReactive(raw);
    const handler = raw instanceof Map || raw instanceof Set ? collectionHandler : Array.isArray(raw) ? arrayHandler : objectHandler;
    const proxy = new Proxy(inner, handler);
    deepProxies.set(raw, proxy);
    innerOf.set(proxy, inner);
    return proxy as T;
}

function isVueFlag(key: PropertyKey): boolean {
    return typeof key === "string" && key.startsWith("__v_");
}

const objectHandler: ProxyHandler<object> = {
    get(inner, key, receiver) {
        const value = Reflect.get(inner, key, receiver);
        return isVueFlag(key) ? value : toDeep(value);
    },
};

/** Reads every item through Vue's tracking, then wraps each. */
function items(outer: unknown[]): unknown[] {
    const inner = innerOf.get(outer as object) as unknown[];
    return Array.from(inner.values(), toDeep);
}

type ArrayMethod = (this: unknown[], ...args: any[]) => unknown;

/** Vue hands raw items to callbacks on a shallow array; these hand wrapped ones. */
const arrayMethods: Record<PropertyKey, ArrayMethod> = {
    every(fn, thisArg) { return items(this).every((item, i) => fn.call(thisArg, item, i, this)); },
    filter(fn, thisArg) { return items(this).filter((item, i) => fn.call(thisArg, item, i, this)); },
    find(fn, thisArg) { return items(this).find((item, i) => fn.call(thisArg, item, i, this)); },
    findIndex(fn, thisArg) { return items(this).findIndex((item, i) => fn.call(thisArg, item, i, this)); },
    findLast(fn, thisArg) { return items(this).findLast((item, i) => fn.call(thisArg, item, i, this)); },
    findLastIndex(fn, thisArg) { return items(this).findLastIndex((item, i) => fn.call(thisArg, item, i, this)); },
    flatMap(fn, thisArg) { return items(this).flatMap((item, i) => fn.call(thisArg, item, i, this)); },
    forEach(fn, thisArg) { items(this).forEach((item, i) => fn.call(thisArg, item, i, this)); },
    map(fn, thisArg) { return items(this).map((item, i) => fn.call(thisArg, item, i, this)); },
    some(fn, thisArg) { return items(this).some((item, i) => fn.call(thisArg, item, i, this)); },
    reduce(fn, ...rest) { return items(this).reduce((acc, item, i) => fn(acc, item, i, this), ...(rest as [unknown])); },
    reduceRight(fn, ...rest) { return items(this).reduceRight((acc, item, i) => fn(acc, item, i, this), ...(rest as [unknown])); },
    toSorted(fn) { return items(this).toSorted(fn); },
    toReversed() { return items(this).toReversed(); },
    toSpliced(...args) { return (items(this) as any).toSpliced(...args); },
    concat(...args) { return items(this).concat(...args.map(toDeep)); },
    values() { return items(this).values(); },
    entries() { return items(this).entries(); },
    [Symbol.iterator]() { return items(this)[Symbol.iterator](); },
};

const arrayHandler: ProxyHandler<object> = {
    get(inner, key, receiver) {
        const method = arrayMethods[key as string];
        if (method !== undefined) return method;
        const value = Reflect.get(inner, key, receiver);
        return isVueFlag(key) ? value : toDeep(value);
    },
};

function wrapIterator(iterator: Iterator<unknown>, pairs: boolean): IterableIterator<unknown> {
    const wrapped: IterableIterator<unknown> = {
        next() {
            const result = iterator.next();
            if (result.done) return result;
            const value = pairs ? (result.value as unknown[]).map(toDeep) : toDeep(result.value);
            return {done: false, value};
        },
        [Symbol.iterator]() { return wrapped; },
    };
    return wrapped;
}

type CollectionMethod = (this: object, ...args: any[]) => unknown;

/** The reads of a Map or Set hand back wrapped values; the writes pass through. */
const collectionMethods: Record<PropertyKey, CollectionMethod> = {
    get(key) { return toDeep((innerOf.get(this) as Map<unknown, unknown>).get(key)); },
    forEach(fn, thisArg) {
        (innerOf.get(this) as Map<unknown, unknown>).forEach((value, key) => fn.call(thisArg, toDeep(value), toDeep(key), this));
    },
    values() { return wrapIterator((innerOf.get(this) as Map<unknown, unknown>).values(), false); },
    keys() { return wrapIterator((innerOf.get(this) as Map<unknown, unknown>).keys(), false); },
    entries() { return wrapIterator((innerOf.get(this) as Map<unknown, unknown>).entries(), true); },
    [Symbol.iterator]() {
        const inner = innerOf.get(this) as Map<unknown, unknown> | Set<unknown>;
        return wrapIterator(inner[Symbol.iterator](), inner instanceof Map);
    },
};

const collectionHandler: ProxyHandler<object> = {
    get(inner, key, receiver) {
        const method = collectionMethods[key as string];
        if (method !== undefined) return method;
        const value = Reflect.get(inner, key, receiver);
        // `size` is a getter; the writes (`set`, `add`, `delete`, `clear`, `has`) are
        // Vue's own instrumented methods and run with the outer proxy as `this`.
        return typeof value === "function" ? value.bind(inner) : value;
    },
};

// ---------------------------------------------------------------------------
// The marks on a field and on a getter.
// ---------------------------------------------------------------------------

const SKIP = "__v_skip";

/**
 * Vue never wraps an object whose `__v_skip` is true, and it reads the flag
 * through the prototype chain. One flag on the class's prototype marks every
 * instance raw for the price of one property lookup, where `markRaw` would
 * define a property on each instance.
 */
function markClassRaw(instance: object): void {
    const proto = Object.getPrototypeOf(instance) as object | null;
    if (proto === null || proto === Object.prototype) {
        markRaw(instance);
        return;
    }
    if (!(SKIP in proto)) Object.defineProperty(proto, SKIP, {value: true, configurable: true});
}

/**
 * Replaces the field `name` of `target` with a getter and a setter. The setter
 * compares first: a value that has not changed is never written. Under `deep`
 * the value is wrapped. The instance is marked raw so Vue never wraps it.
 */
export function installField(target: object, name: PropertyKey, mark: Mark): void {
    const wrap = mark === "deep" ? toDeep : <T>(value: T): T => value;
    const holder = shallowRef(wrap((target as Record<PropertyKey, unknown>)[name]));
    Object.defineProperty(target, name, {
        get: () => holder.value,
        set: (next: unknown) => {
            const value = wrap(next);
            if (Object.is(value, holder.value)) return;
            holder.value = value;
        },
        enumerable: true,
        configurable: true,
    });
    markClassRaw(target);
}

function cachedGetter<This extends object, V>(original: (this: This) => V): (this: This) => V {
    const caches = new WeakMap<This, ComputedRef<V>>();
    return function (this: This): V {
        let cache = caches.get(this);
        if (cache === undefined) {
            cache = computed(() => original.call(this));
            caches.set(this, cache);
        }
        return cache.value;
    };
}

/**
 * Replaces the getter `name` on `target` (a prototype) with one whose result is
 * kept until a marked field it read changes. Each instance keeps its own result.
 */
export function installGetter(target: object, name: PropertyKey): void {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    if (descriptor?.get === undefined) throw new Error(`Tacet: "${String(name)}" is not a getter, so @live has nothing to keep.`);
    Object.defineProperty(target, name, {...descriptor, get: cachedGetter(descriptor.get)});
}

// ---------------------------------------------------------------------------
// The decorators. TypeScript 5's standard decorators, no flag.
// ---------------------------------------------------------------------------

function refuseLegacy(context: unknown): void {
    if (typeof context !== "object" || context === null || !("kind" in context)) {
        throw new Error("Tacet: the marks are standard decorators. Remove `experimentalDecorators` from the tsconfig.");
    }
}

function decorate(mark: Mark, value: unknown, context: DecoratorContext): unknown {
    refuseLegacy(context);
    if (context.kind === "class") throw new Error(`Tacet: @${mark} goes on a field or a getter, not a class.`);
    const name = context.name;
    switch (context.kind) {
        case "field":
            (context as ClassFieldDecoratorContext<object>).addInitializer(function () {
                installField(this, name, mark);
            });
            return;
        case "getter":
            if (mark === "deep") throw new Error(`Tacet: a getter takes @live, not @deep ("${String(name)}").`);
            return cachedGetter(value as (this: object) => unknown);
        case "accessor": {
            // The `accessor` keyword: the getter and the setter sit on the prototype, and
            // the accessor's own private slot holds the ref, so an instance costs one ref.
            const wrap = mark === "deep" ? toDeep : <T>(v: T): T => v;
            const slot = value as ClassAccessorDecoratorTarget<object, {value: unknown}>;
            const result: ClassAccessorDecoratorResult<object, unknown> = {
                get() { return slot.get.call(this).value; },
                set(next) {
                    const holder = slot.get.call(this);
                    const wrapped = wrap(next);
                    if (Object.is(wrapped, holder.value)) return;
                    holder.value = wrapped;
                },
                init(initial) {
                    markClassRaw(this);
                    return shallowRef(wrap(initial));
                },
            };
            return result;
        }
        case "method":
            throw new Error(`Tacet: a method never needs a mark ("${String(name)}").`);
        default:
            throw new Error(`Tacet: @${mark} goes on a field or a getter, not a ${context.kind}.`);
    }
}

/**
 * `@live` on a field: the screen follows the value, not what is inside it.
 * `@live` on a getter: the result is kept until something it read changes.
 */
export function live(value: undefined, context: ClassFieldDecoratorContext): void;
export function live<This, V>(value: (this: This) => V, context: ClassGetterDecoratorContext<This, V>): (this: This) => V;
export function live<This, V>(value: ClassAccessorDecoratorTarget<This, V>, context: ClassAccessorDecoratorContext<This, V>): ClassAccessorDecoratorResult<This, V>;
export function live(value: unknown, context: DecoratorContext): unknown {
    return decorate("live", value, context);
}

/** `@deep` on a field: the screen follows the plain objects and arrays inside it, stopping at any class. */
export function deep(value: undefined, context: ClassFieldDecoratorContext): void;
export function deep<This, V>(value: ClassAccessorDecoratorTarget<This, V>, context: ClassAccessorDecoratorContext<This, V>): ClassAccessorDecoratorResult<This, V>;
export function deep(value: unknown, context: DecoratorContext): unknown {
    return decorate("deep", value, context);
}

// ---------------------------------------------------------------------------
// `this.player.currentTime as live`: one property on one object, followed.
// ---------------------------------------------------------------------------

/** The type that keeps the editor quiet on `x.y as live`; the build rewrites the cast. */
export type live = any;

const watched = new WeakMap<object, Set<PropertyKey>>();

/**
 * What `x.y as live` becomes at build time. At the first read Tacet puts a
 * getter and a setter on that one property of that one object, so a write to
 * it by anyone tells the screen. It must be a plain data property: a getter of
 * the library's, or a frozen object, is an error naming the property, never stale.
 */
export function watch<T extends object, K extends keyof T>(target: T, key: K): T[K] {
    let keys = watched.get(target);
    if (keys === undefined) watched.set(target, keys = new Set());
    if (!keys.has(key)) {
        const descriptor = Object.getOwnPropertyDescriptor(target, key);
        if (descriptor === undefined || !("value" in descriptor) || descriptor.writable !== true || descriptor.configurable !== true) {
            throw new Error(`Tacet: "${String(key)}" cannot be followed with \`as live\`: it is not a plain, writable property of its own on this object.`);
        }
        const holder = shallowRef(descriptor.value);
        Object.defineProperty(target, key, {
            get: () => holder.value,
            set: (next: unknown) => { if (!Object.is(next, holder.value)) holder.value = next; },
            enumerable: descriptor.enumerable,
            configurable: true,
        });
        keys.add(key);
    }
    return target[key];
}

// ---------------------------------------------------------------------------
// A DOM element reaching a view: `ref="view.box"` in a .tacet file.
// ---------------------------------------------------------------------------

const refSetters = new WeakMap<object, Map<PropertyKey, (element: unknown) => void>>();

/**
 * The function a `.tacet` template hands to Vue's `:ref` for `ref="view.box"`.
 * Vue calls it with the element when it is drawn, again on every redraw, and
 * with `null` when it is removed; the field is written only when it differs.
 */
export function setRef(target: object, key: PropertyKey): (element: unknown) => void {
    let setters = refSetters.get(target);
    if (setters === undefined) refSetters.set(target, setters = new Map());
    let setter = setters.get(key);
    if (setter === undefined) {
        setters.set(key, setter = (element: unknown) => {
            const fields = target as Record<PropertyKey, unknown>;
            if (fields[key] !== element) fields[key] = element;
        });
    }
    return setter;
}
