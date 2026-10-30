import {live} from "../../src";

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
    @live public get branchedX(): number { return branched.x.length; }
    @live public get indexedX(): number { return indexed.x.length; }
    @live public get elementX(): number { return element.x.length; }
    @live public get castedX(): number { return casted.x.length; }
    @live public get asserted2X(): number { return asserted2.x.length; }
    @live public get keyed2X(): number { return keyed2.x.length; }
    @live public get namedX(): number { return named.x.length; }
}
