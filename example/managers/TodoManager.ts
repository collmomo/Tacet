import {deep} from "tacet";
import {Todo} from "../entities/Todo";

/** Holds the todos and keeps them. It never knows the screen exists. */
export class TodoManager {
    private static readonly KEY = "todos";
    @deep public todos: Todo[] = [];

    constructor() {
        const rows: {id: string; text: string; isDone: boolean}[] = JSON.parse(localStorage.getItem(TodoManager.KEY) ?? "[]");
        this.todos = rows.map(row => {
            const todo = new Todo(row.text, row.id);
            todo.isDone = row.isDone;
            return todo;
        });
    }

    public add(text: string): void {
        this.todos.push(new Todo(text));
        this.save();
    }

    public toggle(id: string): void {
        this.todos.find(todo => todo.id === id)?.toggle();
        this.save();
    }

    public remove(id: string): void {
        this.todos = this.todos.filter(todo => todo.id !== id);
        this.save();
    }

    private save(): void {
        localStorage.setItem(TodoManager.KEY, JSON.stringify(this.todos));
    }
}
