import type {TodoFilter, TodoView} from "../views/TodoView";

/** The screen's events, held by the view as `view.events`: each one turned into a call on the view or its manager. */
export class TodoEvents {
    private readonly view: TodoView;

    constructor(view: TodoView) {
        this.view = view;
    }

    public handleInput(event: Event): void {
        this.view.typeDraft((event.target as HTMLInputElement).value);
    }

    public handleEnter(): void {
        this.view.addDraft();
    }

    public handleToggle(id: string): void {
        this.view.manager.toggle(id);
    }

    public handleRemove(id: string): void {
        this.view.manager.remove(id);
    }

    public handleFilter(filter: TodoFilter): void {
        this.view.setFilter(filter);
    }
}
