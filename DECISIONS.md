# Decisions

## Decided (the owner, 2026-10-29)

- Components are `.tacet` files: template, script, style, compiled by Vue's compiler (one `include` option, one tsconfig line, one editor line).
- Kept from Vue: the template syntax, props (a parent hands a component its view or object), the lifecycle hooks (`onMounted` and its family).
- Gone: `ref`, `reactive`, `computed`, `watch`, `watchEffect`, `provide`, `inject`, stores, `emit`.
- The marks are `@live` (shallow, compares before writing) and `@deep`. No base class, no call to make things live.
- Written for TypeScript with the owner's conventions; plain JavaScript works through the comment tags.
- A getter is cached only when marked `@live`: it follows what it reads and keeps its result until one of them changes. An unmarked getter is a plain getter. Methods never need a mark. (A `@live` getter must read only marked fields: one that reads a plain field keeps its old value, tested.)
- A DOM element reaches a view through a function ref, `<canvas ref="view.attachCanvas">`: the method gets the element on mount and `null` on unmount and keeps it in a plain field. No `ref()` variable, no `onMounted` for that. Vue alone does not do this (it reads the text as a name; `:ref="view.attachCanvas"` loses `this`), so the `.tacet` step rewrites it to `:ref="el => view.attachCanvas(el)"` (24 lines, tested). Vue calls a function ref again on every redraw with the same element, so the method compares first.

- A template never writes a field: a change goes through a method of the view (`view.typeDraft(...)`), the same method a test or a tool would call (the README's todo app does so).

- The marks are DECORATORS, `@live` and `@deep`, as the README shows them: the `.tacet` build compiles them (TypeScript 5's standard decorators, no flag) so nothing waits on the browsers. The comment tag `/** @live */` is the same mark spelled for plain JavaScript, one runtime under both (the owner, 2026-10-29).

## Open

1. **Arrays and maps under `@live`.** `push`, `set` and `splice` are silent; only a new array or map notifies. Either the rule is "replace it", or such a field must be `@deep`.
2. **A class loaded with no build.** Tags: plain fields, the screen never updates, no error. Decorators: `SyntaxError`. Decide whether the silent case needs a check (for example, the mount warns when a view has no marked field).
3. **One mark makes a whole object raw.** An entity with one `@live` field is no longer seen into by a `@deep` list that holds it: its unmarked fields stop updating the screen (tested). The rule has to say so, or the mark must not make the object raw.
4. **An unmarked class inside `@deep` is walked**, big fields included: the grouping lag's shape. Keep this as "`@deep` means everything inside", or stop `@deep` at any class instance.
5. **The getter on each instance or on the prototype.** On each instance, making an object costs 1.1 µs per marked field, against 0.08 µs on the prototype. A few views do not care; entities made by the thousand do. The tag plugin can write the prototype form; a decorator needs the `accessor` keyword for it.
6. **`<script>` or `<script setup>` in a `.tacet` file.** Vue gives the template a file's top-level names only from `<script setup>`. The README's `<script lang="ts">` needs `setup`, or the plugin adds it.
7. **Vue 3.5 or 3.6.** 3.6 brings the new reactivity and Vapor, but is a release candidate (rc.13, 2026-10-23). The prototype runs on both.
8. **The tag plugin's parser.** TypeScript (already installed with `vue-tsc`, 575 ms to load per build) or a lighter one (Babel's or oxc's parser).
9. **A mistyped tag.** `/** @lvie */` is silently plain. Decide whether the plugin warns on an `@` tag on a field that is close to `live` or `deep`.
10. **Devtools.** Not tried. Open a Tacet view in the Vue devtools in a browser before promising it works there.
