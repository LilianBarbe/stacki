import React from 'react';
import CodeEditor from './CodeEditor.jsx';
import FloatWindow from './FloatWindow.jsx';
import { CodeIcon } from './Icons.jsx';

// The floating code editor: an embed's inner content, a page's frontmatter, a
// text file from public/. The window itself — drag, resize, header, close — is
// FloatWindow, which the variables sheet opens in too.
export default function CodeWindow({ title, language, value, onChange, onClose, editorKey, revealLine }) {
  return (
    <FloatWindow
      className="code-window"
      icon={<CodeIcon size={13} />}
      title={title}
      tag={language}
      onClose={onClose}
      closeHint="Close (edits are saved live)"
    >
      <CodeEditor key={editorKey} language={language} value={value} onChange={onChange} revealLine={revealLine} />
    </FloatWindow>
  );
}
