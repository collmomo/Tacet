import {live} from "../../src";

interface Counter {
    count(): number;
}

export class Thing {
    public value = 1;
}

let moduleLet = 0;

export class BadView {
    public plain = 0;
    @live public rows: {n: number}[] = [];
    @live public config = {size: 1};
    @live public thing = new Thing();
    public readonly counter: Counter = {count: () => 1};
    public readonly onChange: () => number;
    @live public unread = "";

    constructor(onChange: () => number) { this.onChange = onChange; }

    @live public get a(): number { return this.plain; }                 // line 24: a plain field
    @live public get b(): number { return this.rows.length; }           // 23: an array under @live
    @live public get c(): number { return this.config.size; }           // 24: a plain property under @live
    @live public get d(): number { return this.thing.value; }           // 25: a plain field of a class, through @live
    @live public get e(): number { return this.counter.count(); }       // 26: a method on an interface
    @live public get f(): number { return this.onChange(); }            // 27: a function by reference
    @live public get g(): number { return moduleLet; }                  // 28: a module let
    @live public get h(): number { return this.rows.map(row => row.n).length; }   // 29: a callback over an array under @live
    @live public get i(): string { return JSON.stringify(this.config); }         // 30: walked whole
    @live public get j(): number { return this.helper(); }              // 31: through a method, the plain field inside
    private helper(): number { return this.plain * 2; }                 // 32
}
