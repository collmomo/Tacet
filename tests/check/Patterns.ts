import {deep, live} from "../../src";

export class PatternsView {
    @live public rows: {n: number}[] = [];
    @deep public cells: {n: number}[] = [];
    public readonly box: HTMLDivElement = document.createElement("div");

    @live public get dottedLength(): number { return this.rows.length; }
    @live public get destructuredLength(): number { const {length} = this.rows; return length; }
    @live public get dottedDeepLength(): number { return this.cells.length; }
    @live public get destructuredDeepLength(): number { const {length} = this.cells; return length; }
    @live public get destructuredWidth(): number { const {clientWidth} = this.box; return clientWidth; }
}
