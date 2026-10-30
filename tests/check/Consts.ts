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

export class ConstsView {
    @live public get loopedN(): number { return looped[0].n; }
    @live public get keyedN(): number { return keyed[0].n; }
    @live public get typedX(): number { return typed.x; }
    @live public get spreadX(): number { return spread.x; }
    @live public get targetX(): number { return target.x; }
}
