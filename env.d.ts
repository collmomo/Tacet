declare module "*.tacet" {
    import type {DefineComponent} from "vue";
    const component: DefineComponent<{}, {}, any>;
    export default component;
}
