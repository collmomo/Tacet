import {computed, markRaw, shallowReactive, shallowRef, toRaw, type ComputedRef} from "vue";

export type Mark = "live" | "deep";

const proxyByRaw = new WeakMap<object, object>();
const innerByOuter = new WeakMap<object, object>();
let wraps = 0;

/** A class instance is never plain data: its own marks decide its surface. */
function isPlainData(value: unknown): value is object {
    if (typeof value !== "object" || value === null) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null || proto === Array.prototype || proto === Map.prototype || proto === Set.prototype;
}

/** Wraps plain data so the screen follows it; returns anything else as it is. */
export function wrapDeep<T>(value: T): T {
    if (!isPlainData(value)) return value;
    const raw = toRaw(value) as object;
    const known = proxyByRaw.get(raw);
    if (known !== undefined) return known as T;
    const inner = shallowReactive(raw);
    const handler = raw instanceof Map || raw instanceof Set ? collectionHandler : Array.isArray(raw) ? arrayHandler : objectHandler;
    const proxy = new Proxy(inner, handler);
    proxyByRaw.set(raw, proxy);
    innerByOuter.set(proxy, inner);
    wraps++;
    return proxy as T;
}

/** How many deep proxies were made so far; a probe for the tests. */
export function countWraps(): number {
    return wraps;
}

function isVueFlag(key: PropertyKey): boolean {
    return typeof key === "string" && key.startsWith("__v_");
}

const objectHandler: ProxyHandler<object> = {
    get(inner, key, receiver) {
        const value = Reflect.get(inner, key, receiver);
        return isVueFlag(key) ? value : wrapDeep(value);
    },
};

type ArrayMethod = (this: object, ...args: any[]) => unknown;

/** Runs a write on the inner proxy, so one that moves items never reads them through the outer one. */
function writeInner(name: string): ArrayMethod {
    return function (...args) { return (innerByOuter.get(this) as unknown as Record<string, ArrayMethod>)[name](...args); };
}

/** The readers are the natives on the outer proxy: `length` and each index come through Vue's tracking, each item wrapped as the callback reaches it. */
const arrayMethods = Object.assign(Object.create(null) as Record<PropertyKey, ArrayMethod>, {
    concat: Array.prototype.concat,
    entries: Array.prototype.entries,
    every: Array.prototype.every,
    filter: Array.prototype.filter,
    find: Array.prototype.find,
    findIndex: Array.prototype.findIndex,
    findLast: Array.prototype.findLast,
    findLastIndex: Array.prototype.findLastIndex,
    forEach: Array.prototype.forEach,
    map: Array.prototype.map,
    reduce: Array.prototype.reduce,
    reduceRight: Array.prototype.reduceRight,
    some: Array.prototype.some,
    toReversed: Array.prototype.toReversed,
    toSorted: Array.prototype.toSorted,
    toSpliced: Array.prototype.toSpliced,
    values: Array.prototype.values,
    [Symbol.iterator]: Array.prototype[Symbol.iterator],
    copyWithin: writeInner("copyWithin"),
    fill: writeInner("fill"),
    pop: writeInner("pop"),
    push: writeInner("push"),
    reverse: writeInner("reverse"),
    shift: writeInner("shift"),
    sort: writeInner("sort"),
    splice: writeInner("splice"),
    unshift: writeInner("unshift"),
});

const arrayHandler: ProxyHandler<object> = {
    get(inner, key, receiver) {
        const method = arrayMethods[key as string];
        if (method !== undefined) return method;
        const value = Reflect.get(inner, key, receiver);
        return isVueFlag(key) ? value : wrapDeep(value);
    },
};

function wrapIterator(iterator: Iterator<unknown>, pairs: boolean): IterableIterator<unknown> {
    const wrapped: IterableIterator<unknown> = {
        next() {
            const result = iterator.next();
            if (result.done) return result;
            const value = pairs ? (result.value as unknown[]).map(wrapDeep) : wrapDeep(result.value);
            return {done: false, value};
        },
        [Symbol.iterator]() { return wrapped; },
    };
    return wrapped;
}

type CollectionMethod = (this: object, ...args: any[]) => unknown;

/** The reads of a Map or Set hand back wrapped values; the writes stay Vue's. */
const collectionMethods = Object.assign(Object.create(null) as Record<PropertyKey, CollectionMethod>, {
    get(key) { return wrapDeep((innerByOuter.get(this) as Map<unknown, unknown>).get(key)); },
    forEach(fn, thisArg) {
        (innerByOuter.get(this) as Map<unknown, unknown>).forEach((value, key) => fn.call(thisArg, wrapDeep(value), wrapDeep(key), this));
    },
    values() { return wrapIterator((innerByOuter.get(this) as Map<unknown, unknown>).values(), false); },
    keys() { return wrapIterator((innerByOuter.get(this) as Map<unknown, unknown>).keys(), false); },
    entries() { return wrapIterator((innerByOuter.get(this) as Map<unknown, unknown>).entries(), true); },
    [Symbol.iterator]() {
        const inner = innerByOuter.get(this) as Map<unknown, unknown> | Set<unknown>;
        return wrapIterator(inner[Symbol.iterator](), inner instanceof Map);
    },
} satisfies Record<PropertyKey, CollectionMethod>);

const collectionHandler: ProxyHandler<object> = {
    get(inner, key, receiver) {
        const method = collectionMethods[key as string];
        return method !== undefined ? method : Reflect.get(inner, key, receiver);
    },
};

const SKIP = "__v_skip";

/** Vue reads `__v_skip` through the prototype chain, so one flag on the prototype marks every instance raw. */
function markClassRaw(instance: object): void {
    const proto = Object.getPrototypeOf(instance) as object | null;
    if (proto === null || proto === Object.prototype) {
        markRaw(instance);
        return;
    }
    if (!(SKIP in proto)) Object.defineProperty(proto, SKIP, {value: true, configurable: true});
}

/** Replaces the field with a getter and a setter that compares first; under `deep` the value is wrapped. */
export function installField(target: object, name: PropertyKey, mark: Mark): void {
    const wrap = mark === "deep" ? wrapDeep : <T>(value: T): T => value;
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

function cacheGetter<This extends object, V>(original: (this: This) => V): (this: This) => V {
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

/** Replaces the getter on a prototype with one whose result is kept, per instance, until a marked field it read changes. */
export function installGetter(target: object, name: PropertyKey): void {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    if (descriptor?.get === undefined) throw new Error(`Tacet: "${String(name)}" is not a getter, so @live has nothing to keep.`);
    Object.defineProperty(target, name, {...descriptor, get: cacheGetter(descriptor.get)});
}

function refuseLegacyDecorator(context: unknown): void {
    if (typeof context !== "object" || context === null || !("kind" in context)) {
        throw new Error("Tacet: the marks are standard decorators. Remove `experimentalDecorators` from the tsconfig.");
    }
}

function applyMark(mark: Mark, value: unknown, context: DecoratorContext): unknown {
    refuseLegacyDecorator(context);
    if (context.kind === "class") throw new Error(`Tacet: @${mark} goes on a field or a getter, not a class.`);
    const name = String(context.name);
    switch (context.kind) {
        case "field":
            (context as ClassFieldDecoratorContext<object>).addInitializer(function () {
                installField(this, context.name, mark);
            });
            return;
        case "getter":
            if (mark === "deep") throw new Error(`Tacet: a getter takes @live, not @deep ("${name}").`);
            return cacheGetter(value as (this: object) => unknown);
        case "method":
            throw new Error(`Tacet: a method never needs a mark ("${name}").`);
        default:
            throw new Error(`Tacet: @${mark} goes on a field or a getter, not ${context.kind === "accessor" ? "an" : "a"} ${context.kind} ("${name}").`);
    }
}

/** `@live` on a field follows the value, not what is inside it; on a getter it keeps the result until something it read changes. */
export function live(value: undefined, context: ClassFieldDecoratorContext): void;
export function live<This, V>(value: (this: This) => V, context: ClassGetterDecoratorContext<This, V>): (this: This) => V;
export function live(value: unknown, context: DecoratorContext): unknown {
    return applyMark("live", value, context);
}

/** `@deep` on a field follows the plain objects and arrays inside it, stopping at any class. */
export function deep(value: undefined, context: ClassFieldDecoratorContext): void;
export function deep(value: unknown, context: DecoratorContext): unknown {
    return applyMark("deep", value, context);
}

/** The type that keeps the editor quiet on `x.y as live`; the build rewrites the cast. */
export type live = any;

const watchedKeysByTarget = new WeakMap<object, Set<PropertyKey>>();

/** What `x.y as live` becomes: a getter and a setter on that one property, which must be plain and writable, or an error naming it. */
export function watchProperty<T extends object, K extends keyof T>(target: T, key: K): T[K] {
    let keys = watchedKeysByTarget.get(target);
    if (keys === undefined) watchedKeysByTarget.set(target, keys = new Set());
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

const assignersByTarget = new WeakMap<object, Map<PropertyKey, (element: unknown) => void>>();

/** The function `ref="view.box"` hands to Vue: called with the element when drawn, on every redraw, and with `null` when removed; writes only when it differs. */
export function assignElement(target: object, key: PropertyKey): (element: unknown) => void {
    let assigners = assignersByTarget.get(target);
    if (assigners === undefined) assignersByTarget.set(target, assigners = new Map());
    let assigner = assigners.get(key);
    if (assigner === undefined) {
        assigners.set(key, assigner = (element: unknown) => {
            const fields = target as Record<PropertyKey, unknown>;
            if (fields[key] !== element) fields[key] = element;
        });
    }
    return assigner;
}
