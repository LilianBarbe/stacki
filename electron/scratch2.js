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
        if (!rule && candidate.selector === sel) {
            rule = candidate;
        }
    });
    if (!rule) {
        return { ok: false };
    }
    const d = rule.nodes?.find((n) => n.type === 'decl');
    return { d: d?.prop };
}
console.log(f('a'));
