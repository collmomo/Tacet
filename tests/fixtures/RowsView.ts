import {deep} from "../../src";

export class RowsView {
    @deep public rows: {n: number}[] = [{n: 1}, {n: 2}];

    public bump(index: number): void { this.rows[index].n++; }
    public add(n: number): void { this.rows.push({n}); }
}
