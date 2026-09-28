// Exercise the inline source/DOM contract without browser editing quirks: keep
// supported markup and expressions, flatten unknown wrappers, and reject bounds.
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const loadRenderer = require('./renderer-module');
const { domToNodes, nodesToHtml, isInlineOnly } = loadRenderer('ui/richContentModel.ts');
const dom = new JSDOM('<!doctype html><div id="host"></div>');
const host = dom.window.document.getElementById('host');
host.innerHTML = 'Hello <b title="drop">world</b><div>{post.title}</div><br>';
const nodes = domToNodes(host);
assert.deepEqual(nodes, [
  { kind: 'text', value: 'Hello ' },
  { kind: 'element', name: 'strong', props: {}, children: [{ kind: 'text', value: 'world' }] },
  { kind: 'expr', value: '{post.title}' },
  { kind: 'element', name: 'br', props: {}, children: null },
]);
assert.equal(isInlineOnly(nodes), true);
assert.match(nodesToHtml(nodes), /data-expr="\{post.title\}"/);
assert.equal(isInlineOnly([{ kind: 'text' }]), false);
assert.equal(
  isInlineOnly([
    {
      kind: 'element',
      name: 'span',
      props: {
        title: { type: 'string' },
      },
      children: [],
    },
  ]),
  false,
);
const text = { kind: 'text', value: '' };
assert.throws(() => nodesToHtml(Array(20001).fill(text)), /node limit exceeded/);
const cyclic = { kind: 'element', name: 'span', children: [] };
cyclic.children.push(cyclic);
assert.throws(() => isInlineOnly([cyclic]), /depth limit exceeded/);
assert.throws(() => nodesToHtml([cyclic]), /depth limit exceeded/);
host.textContent = '{a}'.repeat(20001);
assert.throws(() => domToNodes(host), /expression limit exceeded/);
host.textContent = 'x'.repeat(1000001);
assert.throws(() => domToNodes(host), /text limit exceeded/);
host.textContent = '';
let parent = host;
for (let depth = 0; depth < 66; depth++) {
  const child = dom.window.document.createElement('span');
  parent.appendChild(child);
  parent = child;
}
assert.throws(() => domToNodes(host), /DOM depth limit exceeded/);

// Text the field emits is the text the parser will hold: whitespace runs
// squeeze to one space with one space kept at either boundary. The save echo
// comes back through the parser's own text rule (collapseText in
// electron/astroParser.ts), so anything looser made the echoed value differ
// from the last emission and the field's sync reset the caret mid-word.
host.textContent = 'hello  ';
assert.deepEqual(domToNodes(host), [{ kind: 'text', value: 'hello ' }]);
host.textContent = ' hello';
assert.deepEqual(domToNodes(host), [{ kind: 'text', value: ' hello' }]);
host.textContent = 'a\n b';
assert.deepEqual(domToNodes(host), [{ kind: 'text', value: 'a b' }]);
host.innerHTML = 'hi {x}  there';
assert.deepEqual(domToNodes(host), [
  { kind: 'text', value: 'hi ' },
  { kind: 'expr', value: '{x}' },
  { kind: 'text', value: ' there' },
]);

dom.window.close();
console.log('renderer-rich: inline round trips, invalid shapes, and traversal limits passed');
