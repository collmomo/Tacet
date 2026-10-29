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
    public readonly date = new Date(0);
    public readonly box: HTMLDivElement = document.createElement("div");

    constructor(onChange: () => number) { this.onChange = onChange; }

    @live public get a(): number { return this.plain; }                          // a plain field
    @live public get b(): number { return this.rows.length; }                    // an array under @live
    @live public get c(): number { return this.config.size; }                    // a plain property under @live
    @live public get d(): number { return this.thing.value; }                    // a plain field of a class, through @live
    @live public get e(): number { return this.counter.count(); }                // a method on an interface
    @live public get f(): number { return this.onChange(); }                     // a function by reference
    @live public get g(): number { return moduleLet; }                           // a module let
    @live public get h(): number { return this.rows.map(row => row.n).length; }  // a callback over an array under @live
    @live public get i(): string { return JSON.stringify(this.config); }         // walked whole
    @live public get j(): number { return this.helper(); }                       // through a method, the plain field inside
    private helper(): number { return this.plain * 2; }
    @live public get k(): number { return this.date.getTime(); }                 // a library object held in place
    @live public get l(): number { return this.box.clientWidth; }                // a DOM element held in place
    @live public get m(): string { return localStorage.getItem("x") ?? ""; }     // a global library object
    @live public get n(): number { return Date.now(); }                          // a global library object's method
    @live public get o(): string { return document.title; }                      // a global library object's property
}
