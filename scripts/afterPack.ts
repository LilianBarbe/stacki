// electron-builder hook that restores node-pty's spawn-helper execute bit in
// the copied application, where packaging can otherwise remove it.

import fs = require('node:fs');
import path = require('node:path');
import type { AfterPackContext } from 'app-builder-lib';
import { fixNodePtyPermissions } from './fix-node-pty-permissions';

export default function afterPack(context: AfterPackContext): void {
  if (context.electronPlatformName === 'win32') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const unpacked =
    context.electronPlatformName === 'darwin'
      ? path.join(
          context.appOutDir,
          `${appName}.app`,
          'Contents',
          'Resources',
          'app.asar.unpacked',
        )
      : path.join(context.appOutDir, 'resources', 'app.asar.unpacked');
  const nodePtyDirectory = path.join(unpacked, 'node_modules', 'node-pty');

  if (!fs.existsSync(nodePtyDirectory)) {
    console.warn(
      '  • afterPack: node-pty not found in the packaged app; the terminal will not start.',
    );
    return;
  }

  const fixed = fixNodePtyPermissions(nodePtyDirectory);
  console.log(
    fixed.length > 0
      ? `  • afterPack: restored exec bit on ${fixed.length} node-pty spawn-helper(s)`
      : '  • afterPack: node-pty spawn-helper already executable',
  );
}
