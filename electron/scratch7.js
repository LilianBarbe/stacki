"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.moveHeading = moveHeading;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const postcss_1 = __importDefault(require("postcss"));
function moveHeading(projectPath, { file, selector, start, end, expect, before }) {
    const abs = path_1.default.resolve(projectPath, file);
    const text = fs_1.default.readFileSync(abs, 'utf8');
    if (expect !== undefined && text.slice(start, end) !== expect) {
        return { ok: false, stale: true, error: 'This file changed since the panel read it.' };
    }
    const open = text.lastIndexOf('/*', start);
    const close = text.indexOf('*/', end);
    if (open === -1 || close === -1) {
        return { ok: false, error: 'That heading is no longer a comment.' };
    }
    const comment = text.slice(open, close + 2);
    let from = open;
    let to = close + 2;
    const lineStart = text.lastIndexOf('\n', from - 1) + 1;
    const lineEnd = text.indexOf('\n', to);
    if (!text.slice(lineStart, from).trim() && !text.slice(to, lineEnd === -1 ? text.length : lineEnd).trim()) {
        from = lineStart;
        to = lineEnd === -1 ? text.length : lineEnd + 1;
    }
    const cut = text.slice(0, from) + text.slice(to);
    const root = postcss_1.default.parse(cut);
    let rule = null;
    root.walkRules((candidate) => {
        if (!rule && candidate.selector === selector) {
            rule = candidate;
        }
    });
    if (!rule) {
        return { ok: false, error: `${selector} is no longer in ${file}.` };
    }
    const decls = (rule.nodes || []).filter((n) => n.type === 'decl');
    const anchorDecl = before ? decls.find((d) => d.prop === before) : undefined;
    let at;
    if (anchorDecl) {
        const offset = anchorDecl.source?.start?.offset ?? 0;
        at = cut.lastIndexOf('\n', offset - 1) + 1;
    }
    else {
        // After everything: the line following the last declaration, or just inside
        // the brace when the rule has none left.
        const last = decls[decls.length - 1];
        if (last) {
            const offset = last.source?.end?.offset ?? 0;
            const nl = cut.indexOf('\n', offset);
            at = nl === -1 ? cut.length : nl + 1;
        }
        else {
            const openOffset = rule.source?.start?.offset ?? 0;
            at = cut.indexOf('{', openOffset) + 2;
        }
    }
    const indent = cut.slice(cut.lastIndexOf('\n', at - 1) + 1, at).match(/^\s*/)?.[0] || '  ';
    fs_1.default.writeFileSync(abs, `${cut.slice(0, at)}${indent}${comment}\n${cut.slice(at)}`, 'utf8');
    return { ok: true };
}
