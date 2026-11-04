import {live} from "../../src";

export class Counter {
    public plain = 0;
    @live public count = 0;
}

const pushed: number[] = [];
pushed.push(1);
const written = {x: 1};
written.x = 2;
export const exported = {x: 1};
const alias = written;
const kids = document.body.children;
const handed = {list: [1]};
grow(handed);
const counter = new Counter();
let moduleLet = 0;
moduleLet++;

function grow(value: {list: number[]}): number { value.list.push(2); return value.list.length; }

export class ConstsView {
    @live public get pushedRows(): number { return pushed.length + pushed.map(n => n * 2).length; }
    @live public get writtenX(): number { return written.x + exported.x + alias.x; }
    @live public get kidsLength(): number { return kids.length; }
    @live public get handedLength(): number { return grow(handed) + handed.list.length; }
    @live public get liveCount(): number { return counter.count; }
    @live public get plainCount(): number { return counter.plain; }
    @live public get letRead(): number { return moduleLet; }
}
