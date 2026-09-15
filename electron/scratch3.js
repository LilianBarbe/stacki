"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const postcss_1 = __importDefault(require("postcss"));
function f(sel) {
    const root = postcss_1.default.parse('a {}');
    let rule = null;
    root.walkRules((candidate) => {
        const c = candidate; // is candidate assignable to PRule?
        if (!rule && candidate.selector === sel) {
            rule = candidate;
        }
    });
    if (!rule) {
        return 'none';
    }
    const sel2 = rule.selector; // narrows to?
    const decls = rule.nodes;
    return sel2 + String(decls.length);
}
console.log(f('a'));
