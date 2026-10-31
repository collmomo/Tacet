import {deep, live} from "../../src";

const looped = [{n: 1}];
const keyed = [{n: 2}];
const sums: number[] = [];
for (const row of looped) sums.push(row.n);
for (const key in keyed) sums.push(key.length);
export const total = sums.length;

const typed = {x: 1};
export type TypedX = typeof typed.x;

const spread = {x: 1};
[spread.x] = [2];

const target = {x: 1};
for (target.x of [3]) {}

const pattern = {x: 1};
for ([pattern.x] of [[4]]) {}

const paren = {x: 1};
[(paren.x)] = [5];

const held = {x: 1};
const copies = [[held.x]];
export const copyCount = copies.length;

const counted = {x: 1};
(counted.x)++;

const added = {x: 1};
(added.x) += 1;

const deleted: {x?: number} = {x: 1};
delete (deleted.x);

const pushed = {x: [1]};
(pushed.x).push(2);

const pathed = {x: {y: 1}};
(pathed.x).y = 2;

const asserted = {x: {y: 1}};
(asserted.x as {y: number}).y = 2;

const satisfied = {x: {y: 1}};
(satisfied.x satisfies {y: number}).y = 2;

const sequenced = {x: {y: 1}};
(0, sequenced.x).y = 2;

const found = {x: [{y: 1}]};
found.x.find(() => true)!.y = 2;

const ored = {x: {y: 1}};
(ored.x || {y: 0}).y = 2;

const chosen = {x: {y: 1}};
(Math.random() > 2 ? chosen.x : {y: 0}).y = 2;

const wrapped = {x: [1]};
(wrapped.x.push)(2);

const copied = {x: [1]};
copied.x.slice().push(2);
copied.x.map(n => n)[0] = 1;
copied.x.slice().sort();
copied.x.filter(n => n > 0).reverse().length = 0;

const labelled = {x: "a,b"};
labelled.x.split(",").reverse();

const element = {x: [{y: 1}]};
element.x.filter(() => true)[0].y = 2;

const branched = {x: [1]};
const key = "push";
(Math.random() > 2 ? branched.x[key] : branched.x.slice)(2);

const indexed = {x: [(n: number) => n]};
indexed.x[0](2);
for (let i = 0; i < indexed.x.length; i++) indexed.x[i](2);

const anded = {x: [1]};
const noop = (n: number): number => n;
(anded.x.push && noop)(2);

const dated = {x: new Date(0)};
dated.x.setFullYear(2030);

const applied = {x: [1]};
applied.x.push.apply(applied.x, [2]);

const mapped = {x: new Map<string, any>()};
mapped.x.get("k").push(1);

const joined = {x: [1]};
export const joinedLength = joined.x.join(",").length;

const unknowns = {x: new Map<string, unknown>()};
(unknowns.x.get("k") as number[]).push(1);

const keyedPrimitive = {x: "a,b"};
const primitiveKey: "trim" | "toUpperCase" = Math.random() > 2 ? "trim" : "toUpperCase";
keyedPrimitive.x[primitiveKey]();

const helpers = {x: 1, format: (n: number): string => String(n)};
export const formatted = helpers.format(2);

type Id = string & {__brand: "id"};
const branded = {x: "a" as Id};
export const brandedLength = branded.x.trim().length;

const mixed = {x: "" as string | string[]};
export const mixedLength = mixed.x.slice(0).length;

const bound = {x: (): number => 1, y: 2};
export const bounded = bound.x.call(null);

const slots = {x: [(): {y: number} => ({y: 1})], n: 1};
slots.x[0]().y = 2;

const slotsRead = {x: [(): {y: number} => ({y: 1})], n: 1};
export const slotText = slotsRead.x[0]().y.toString();

const bag = {x: [1], add(): void { this.x.push(2); }};
bag.add();

interface Sack { x: number[]; add(): void; }
const sack: Sack = {x: [1], add(): void { this.x.push(2); }};
sack.add();

const callable = {x: Object.assign((): number => 1, {items: [] as number[], add(n: number): void { this.items.push(n); }})};
callable.x.add(3);

const bindable = {x: (): number => 1, y: 2};
export const rebound = bindable.x.bind(null);

const boundPush = {x: [1]};
const pushLater = boundPush.x.push.bind(boundPush.x);
pushLater(2);

interface Helper { x: number; format: (n: number) => string; }
const helper: Helper = {x: 1, format: (n: number): string => String(n)};
export const helped = helper.format(2);

const shorthandFormat = (n: number): string => String(n);
const holder = {x: 1, shorthandFormat};
export const holderText = holder.shorthandFormat(2);

const parenthesised = {x: 1, f: ((n: number): string => String(n))};
export const parenText = parenthesised.f(2);

const stringified = {x: [1]};
export const stringifiedText = stringified.toString();

type Tagged = string & {__tag: {id: never}};
const tagged = {x: "a" as Tagged};
export const taggedLength = tagged.x.trim().length;

type Loop = string & {__brand: Loop};
const looping = {x: "a" as Loop};
export const loopingLength = looping.x.trim().length;

interface Bumper { x: number; bump: (n: number) => string; }
const bumping: Bumper = {x: 1, bump(n: number): string { this.x += n; return ""; }};
bumping.bump(2);

function bumpThis(this: {x: number}): void { this.x++; }
const shorthandBump = {x: 1, bumpThis};
shorthandBump.bumpThis();

const accessed = {x: 1, get f(): () => number { this.x++; return () => 1; }};
accessed.f();

const satisfied2 = {x: 1, f: function (this: {x: number}): void { this.x++; } satisfies (this: {x: number}) => void};
satisfied2.f();

const augmented = {x: [1]};
augmented.fillAll();

type Indexed = string & {[key: string]: number[]};
const indexedBrand = {x: {} as Indexed};
indexedBrand.x.list.push(1);

interface VoidThis { x: number; format: (this: void, n: number) => string; }
const voidThis: VoidThis = {x: 1, format: (n: number): string => String(n)};
export const voidText = voidThis.format(2);

class ArrowField { public x = 1; public bump = (): void => { this.x++; }; }
const fielded = {x: 1, b: new ArrowField()};
fielded.b.bump();

const augmentedArray = {x: [1]};
augmentedArray.x.fillAll();

const spreadImpl = {f(): void { this.x++; }, x: 0};
const spreadOver = {x: 1, f: (): void => {}, ...spreadImpl};
spreadOver.f();

type VoidFn = (this: void, n: number) => string;
interface AliasVoid { x: number; format: VoidFn; }
const aliasVoid: AliasVoid = {x: 1, format: (n: number): string => String(n)};
const aliasHolder = {inner: aliasVoid};
export const aliasText = aliasHolder.inner.format(2);

interface MethodVoid { x: number; format(this: void, n: number): string; }
const methodVoid: MethodVoid = {x: 1, format: (n: number): string => String(n)};
const methodHolder = {inner: methodVoid};
export const methodText = methodHolder.inner.format(2);

const helperHolder = {inner: helper};
export const heldHelperText = helperHolder.inner.format(2);

const kids = document.body.children;

interface OptionalVoid { x: number; format?: (this: void, n: number) => string; }
const optionalVoid: OptionalVoid = {x: 1, format: (n: number): string => String(n)};
const optionalHolder = {inner: optionalVoid};
export const optionalText = optionalHolder.inner.format?.(2);

const replaced = {x: [1], f: (): void => {}};
replaced.f = function (this: {x: number[]}): void { this.x.push(2); };
replaced.f();

interface Annotated { x: number[]; f: (n: number) => void; }
const annotated: Annotated = {x: [1], f: (): void => {}};
annotated.f(2);

const count = {n: kids.length, items: [1]};

const heldApi = {x: [1], api};
export const apiText = heldApi.api.format(2);

const heldKids = {inner: kids, items: [1]};
const kidsAlias = kids;
const doc = document;

const destructured = {x: [1]};
const {x: taken} = destructured;
taken.push(2);

const holdsCount = {inner: count};

const accessed2 = {get inner(): {items: number[]} { return {items: [1]}; }};

const accessedKids = {get inner(): HTMLCollection { return document.body.children; }};

const nestedKids = {inner: {list: document.body.children, items: [1]}};

const KEYS = Object.keys({a: 1});

const methodHeld = {m(): number { return 1; }, n: 2};
export const methodValue = methodHeld.m;

export const sharedList = {x: [1]};
const sealed = Object.seal(sharedList);

const selfRead = {items: [1], get n(): number { return this.items.length; }};

class DeepHolder { @deep public items = {list: [1]}; }
const deepHolder = new DeepHolder();
const snap = deepHolder.items;

const escaping = {inner: {x: [1]}};
const ref = escaping.inner;
ref.x = [2];

const blocked = {items: [1], get n(): number { if (Math.random() > 2) { return this.items.length; } return 0; }};

const looped2 = {list: [{x: [1]}]};
for (const entry of looped2.list) entry.x = [2];

const picked = {list: [{x: [1]}]};
const pick = picked.list.find(() => true);
if (pick !== undefined) pick.x = [2];

const selfEscaped = {items: [1], get n(): number { return this.items.length; }};
const itemsRef = selfEscaped.items;
itemsRef.push(2);

const SPACED = Object
    .keys({a: 1});

const quoted = {"y": sharedList};

const mapped2 = {items: [1], other: [2], get n(): number { return this.items.map(() => this.other.length)[0]; }};

const keyedLoop = {inner: {a: 1}, other: {x: [1]}};
for (const key in keyedLoop.inner) sums.push(key.length);

const numbered = {nums: [1, 2], other: {x: [1]}};
for (const n of numbered.nums) sums.push(n);

interface Shape { items: number[]; n: number; }
const satisfiedSelf = {items: [1], get n(): number { return this.items.length; }} satisfies Shape;
const satisfiedRef = satisfiedSelf.items;
satisfiedRef.push(2);

interface Bumpy { bump: () => number; inner: {x: number[]}; n: number; }
const bumpy: Bumpy = {bump: (): number => 0, inner: {x: [1]}, n: 1};
const bumpyRef = bumpy.inner;
export const bumped = bumpy.bump() + bumpyRef.x.length;

const iterable = {items: [1], *[Symbol.iterator](): Generator<number> { yield 1; }};

const jsonLike: Pick<JSON, "parse"> = {parse: (): unknown => sharedList};
const parsedLike = jsonLike.parse("") as {x: number[]};

const thisArgged = {items: [1], other: [2], get n(): number { return this.items.map(function (this: {other: number[]}): number { return this.other.length; }, this)[0]; }};
const otherRef = thisArgged.other;
otherRef.push(3);

const selfish = {n: 1, get self(): {n: number} { return this; }};
const selfAlias = selfish.self;
selfAlias.n = 2;

const called = {items: [1], get n(): number { return (function (this: {items: number[]}): number { return this.items.length; }).call(this); }};
const calledRef = called.items;
calledRef.push(2);

const globalKeys = globalThis.Object.keys({a: 1});

const holder2 = {list: [1]};
const holder2Ref = holder2.list;
holder2Ref.push(2);

const selfKeyed = {n: 1, get self(): {n: number} { return this; }};
const selfKeyedAlias = selfKeyed["self"];
selfKeyedAlias.n = 2;

const fakeGlobal: Pick<typeof globalThis, "Object"> = {Object: Object};
const fakeKeys = fakeGlobal.Object.keys({a: 1});

const listMaker = {n: 1, get list(): number[] { return [1, 2]; }};
const made = listMaker.list;
made.push(3);

function handOver(): {list: number[]} { return holder2; }

const handlerHolder = {fn: (n: number): number => n};
handlerHolder.fn = (n: number): number => n + 1;

const valued = {n: 1};
const valuedSelf = valued.valueOf();
valuedSelf.n = 2;

const delegating = {n: 1, me(): {n: number} { return this; }, get self(): {n: number} { return this.me(); }};
const delegated = delegating.self;
delegated.n = 2;

const symbolKey = Symbol("k");
const symbolic = {n: 1, get [symbolKey](): {n: number} { return this; }};
const symbolicSelf = symbolic[symbolKey];
symbolicSelf.n = 2;

const wrapping = {n: 1, get wrap(): {toString(): string} { return {toString(): string { return String(this); }}; }};
const wrapped = wrapping.wrap;
export const wrappedText = wrapped.toString();

const casted = {x: [1]};
(casted.x.push as (n: number) => number)(2);

const asserted2 = {x: [1]};
(asserted2.x.push!)(2);

const keyed2 = {x: [1]};
keyed2.x["push"](2);

const named = {x: [1]};
const method = "push";
named.x[method](2);

export class ConstsView {
    @live public get loopedN(): number { return looped[0].n; }
    @live public get keyedN(): number { return keyed[0].n; }
    @live public get typedX(): number { return typed.x; }
    @live public get spreadX(): number { return spread.x; }
    @live public get targetX(): number { return target.x; }
    @live public get patternX(): number { return pattern.x; }
    @live public get parenX(): number { return paren.x; }
    @live public get heldX(): number { return held.x; }
    @live public get countedX(): number { return counted.x; }
    @live public get addedX(): number { return added.x; }
    @live public get deletedX(): number | undefined { return deleted.x; }
    @live public get pushedX(): number { return pushed.x.length; }
    @live public get pathedX(): number { return pathed.x.y; }
    @live public get assertedX(): number { return asserted.x.y; }
    @live public get satisfiedX(): number { return satisfied.x.y; }
    @live public get sequencedX(): number { return sequenced.x.y; }
    @live public get foundX(): number { return found.x.length; }
    @live public get oredX(): number { return ored.x.y; }
    @live public get chosenX(): number { return chosen.x.y; }
    @live public get wrappedX(): number { return wrapped.x.length; }
    @live public get copiedX(): number { return copied.x.length; }
    @live public get labelledX(): number { return labelled.x.length; }
    @live public get andedX(): number { return anded.x.length; }
    @live public get datedX(): number { return dated.x.getFullYear(); }
    @live public get appliedX(): number { return applied.x.length; }
    @live public get mappedX(): number { return mapped.x.size; }
    @live public get joinedX(): number { return joined.x.length; }
    @live public get unknownsX(): number { return unknowns.x.size; }
    @live public get keyedPrimitiveX(): number { return keyedPrimitive.x.length; }
    @live public get helpersX(): number { return helpers.x; }
    @live public get brandedX(): number { return branded.x.length; }
    @live public get mixedX(): number { return mixed.x.length; }
    @live public get boundY(): number { return bound.y; }
    @live public get slotsN(): number { return slots.n; }
    @live public get slotsReadN(): number { return slotsRead.n; }
    @live public get bagX(): number { return bag.x.length; }
    @live public get sackX(): number { return sack.x.length; }
    @live public get callableX(): number { return callable.x.items.length; }
    @live public get bindableY(): number { return bindable.y; }
    @live public get boundPushX(): number { return boundPush.x.length; }
    @live public get helperX(): number { return helper.x; }
    @live public get holderX(): number { return holder.x; }
    @live public get parenthesisedX(): number { return parenthesised.x; }
    @live public get stringifiedX(): number { return stringified.x.length; }
    @live public get taggedX(): number { return tagged.x.length; }
    @live public get loopingX(): number { return looping.x.length; }
    @live public get bumpingX(): number { return bumping.x; }
    @live public get shorthandBumpX(): number { return shorthandBump.x; }
    @live public get accessedX(): number { return accessed.x; }
    @live public get satisfied2X(): number { return satisfied2.x; }
    @live public get augmentedX(): number { return augmented.x.length; }
    @live public get indexedBrandX(): number { return indexedBrand.x.length; }
    @live public get voidThisX(): number { return voidThis.x; }
    @live public get fieldedX(): number { return fielded.b.x; }
    @live public get augmentedArrayX(): number { return augmentedArray.x.length; }
    @live public get spreadOverX(): number { return spreadOver.x; }
    @live public get aliasHolderX(): number { return aliasHolder.inner.x; }
    @live public get methodHolderX(): number { return methodHolder.inner.x; }
    @live public get helperHolderX(): number { return helperHolder.inner.x; }
    @live public get kidsCount(): number { return kids.length; }
    @live public get optionalHolderX(): number { return optionalHolder.inner.x; }
    @live public get replacedX(): number { return replaced.x.length; }
    @live public get annotatedX(): number { return annotated.x.length; }
    @live public get countItems(): number { return count.items.length; }
    @live public get heldApiX(): number { return heldApi.x.length; }
    @live public get heldKidsCount(): number { return heldKids.inner.length; }
    @live public get heldKidsItems(): number { return heldKids.items.length; }
    @live public get kidsAliasCount(): number { return kidsAlias.length; }
    @live public get docCount(): number { return doc.body.children.length; }
    @live public get destructuredX(): number { return destructured.x.length; }
    @live public get holdsCountItems(): number { return holdsCount.inner.items.length; }
    @live public get accessed2Items(): number { return accessed2.inner.items.length; }
    @live public get accessedKidsCount(): number { return accessedKids.inner.length; }
    @live public get nestedKidsCount(): number { return nestedKids.inner.list.length; }
    @live public get nestedKidsItems(): number { return nestedKids.inner.items.length; }
    @live public get keysCount(): number { return KEYS.length; }
    @live public get accessedKidsAgain(): number { return accessedKids.inner.length; }
    @live public get sealedX(): number { return sealed.x.length; }
    @live public get selfReadN(): number { return selfRead.n; }
    @live public get snapList(): number { return snap.list.length; }
    @live public get escapingX(): number { return escaping.inner.x.length; }
    @live public get blockedN(): number { return blocked.n; }
    @live public get looped2X(): number { return looped2.list[0].x.length; }
    @live public get pickedX(): number { return picked.list[0].x.length; }
    @live public get selfEscapedN(): number { return selfEscaped.n; }
    @live public get spacedCount(): number { return SPACED.length; }
    @live public get quotedY(): number { return quoted.y.x.length; }
    @live public get mapped2N(): number { return mapped2.n; }
    @live public get keyedLoopX(): number { return keyedLoop.other.x.length; }
    @live public get numberedX(): number { return numbered.other.x.length; }
    @live public get satisfiedSelfN(): number { return satisfiedSelf.n; }
    @live public get bumpyN(): number { return bumpy.n; }
    @live public get iterableItems(): number { return iterable.items.length; }
    @live public get parsedLikeX(): number { return parsedLike.x.length; }
    @live public get thisArggedN(): number { return thisArgged.n; }
    @live public get selfishN(): number { return selfish.n; }
    @live public get calledN(): number { return called.n; }
    @live public get globalKeysCount(): number { return globalKeys.length; }
    @live public get holder2Mapped(): number { return [0].map(function (this: {list: number[]}): number { return this.list.length; }, holder2)[0]; }
    @live public get holder2Applied(): number { return (function (a: {list: number[]}): number { return a.list.length; }).apply(null, [holder2]); }
    @live public get holder2From(): number { return Array.from([0], function (this: {list: number[]}): number { return this.list.length; }, holder2)[0]; }
    @live public get selfKeyedN(): number { return selfKeyed.n; }
    @live public get fakeKeysCount(): number { return fakeKeys.length; }
    @live public get listMakerN(): number { return listMaker.n; }
    @live public get holder2Returned(): number { return handOver().list.length; }
    @live public get handlerByName(): number { return [0].map(handlerHolder.fn)[0]; }
    @live public get valuedN(): number { return valued.n; }
    @live public get delegatingN(): number { return delegating.n; }
    @live public get symbolicN(): number { return symbolic.n; }
    @live public get wrappingN(): number { return wrapping.n; }
    @live public get holder2GlobalFrom(): number { return globalThis.Array.from([0], function (this: {list: number[]}): number { return this.list.length; }, holder2)[0]; }
    @live public get branchedX(): number { return branched.x.length; }
    @live public get indexedX(): number { return indexed.x.length; }
    @live public get elementX(): number { return element.x.length; }
    @live public get castedX(): number { return casted.x.length; }
    @live public get asserted2X(): number { return asserted2.x.length; }
    @live public get keyed2X(): number { return keyed2.x.length; }
    @live public get namedX(): number { return named.x.length; }
}
