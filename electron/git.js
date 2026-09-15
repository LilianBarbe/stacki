"use strict";
// The git runner main.js provides (over a PATH it repairs for the packaged
// app), as the git modules here take it. One home: gitSnapshot, gitBranches,
// gitHistory, previewWorktree and contentConfig all shell out through it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.gitErrorDetail = gitErrorDetail;
exports.gitErrorFull = gitErrorFull;
const record_js_1 = require("../shared/dist/record.js");
const stderrOf = (err) => {
    const stderr = (0, record_js_1.toRecord)(err)?.['stderr'];
    return typeof stderr === 'string' ? stderr : undefined;
};
/** stderr first, then the message — git's own wording leads. */
function gitErrorDetail(err) {
    // `||`, not `??`: an empty stderr falls through to the message, as the
    // untyped code's `err.stderr || err.message` did.
    return stderrOf(err) || (err instanceof Error ? err.message : '');
}
/** Both streams, stdout first — used where git reports conflicts on stdout. */
function gitErrorFull(err) {
    const stdout = (0, record_js_1.toRecord)(err)?.['stdout'];
    return `${typeof stdout === 'string' ? stdout : ''}\n${gitErrorDetail(err)}`;
}
