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

const copied = {x: [1]};
copied.x.slice().push(2);
copied.x.map(n => n)[0] = 1;

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
    @live public get copiedX(): number { return copied.x.length; }
}
