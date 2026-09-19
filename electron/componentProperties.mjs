import { randomUUID } from 'node:crypto';
import {
  readPropertyConsumers,
  readBoundedSource,
  filesystemError,
} from './propertyConsumers.mjs';
// Plan against exact source revisions, then commit as one synchronous batch.
// Failed writes restore earlier files so a rename cannot leave half the site on the old API.
import fs from 'node:fs';
import path from 'node:path';
import { assert } from '../shared/assert.mjs';
import {
  PROPERTY_LIMITS,
  parsePropertyLocation,
  parsePropertyRequest,
} from '../shared/component-properties.mjs';
import { err, ok } from '../shared/result.mjs';
import { sameFilesystemPath } from './platform.js';
import {
  editPropertyDefinition,
  readComponentProperties,
} from './propertyDefinitions.mjs';
import { renameComponentReferences } from './propertyRename.mjs';
export function loadComponentProperties(location) {
  location = parsePropertyLocation(location);
  const target = validateLocation(location);
  if (!target.ok) {
    return target;
  }
  const source = readBoundedSource(target.value.file);
  if (!source.ok) {
    return source;
  }
  return ok(readComponentProperties(source.value));
}
export function updateComponentProperties(request, noteWrite) {
  request = parsePropertyRequest(request);
  const target = validateLocation(request);
  if (!target.ok) {
    return target;
  }
  const source = readBoundedSource(target.value.file);
  if (!source.ok) {
    return source;
  }
  if (source.value !== request.source) {
    return err({
      code: 'conflict',
      message: 'This component changed on disk. Reload before saving.',
    });
  }
  const changed = editPropertyDefinition(source.value, request.change);
  if (!changed.ok) {
    return changed;
  }
  const plan = planPropertyChanges(
    { ...request, ...target.value },
    changed.value,
  );
  if (!plan.ok) {
    return plan;
  }
  const result = commitPropertyChanges(plan.value, noteWrite);
  if (!result.ok) {
    return result;
  }
  const updated = plan.value.find((entry) =>
    sameFilesystemPath(entry.file, target.value.file),
  );
  assert(updated !== undefined, 'Property transaction includes the component');
  return ok(readComponentProperties(updated.after));
}
function validateLocation(location) {
  let root;
  let file;
  try {
    root = fs.realpathSync(path.join(location.projectPath, 'src'));
    file = fs.realpathSync(location.file);
  } catch (error) {
    return filesystemError(error);
  }
  const relative = path.relative(root, file);
  if (
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    !file.endsWith('.astro')
  ) {
    return err({
      code: 'path',
      message: 'Select an Astro component inside this project’s src folder.',
    });
  }
  return ok({ projectPath: path.dirname(root), file });
}
function planPropertyChanges(request, source) {
  const change = request.change;
  const first = { file: request.file, before: request.source, after: source };
  if (change.kind === 'remove') {
    return planPropertyRemoval(request, first, change.name);
  }
  if (
    change.kind !== 'save' ||
    !change.originalName ||
    change.originalName === change.property.name
  ) {
    return ok([first]);
  }
  const consumers = readPropertyConsumers(request);
  if (!consumers.ok) {
    return consumers;
  }
  const rename = { from: change.originalName, to: change.property.name };
  const changes = [];
  for (const consumer of consumers.value) {
    const { file, names } = consumer;
    const own = sameFilesystemPath(file, request.file);
    const original = own ? source : consumer.source;
    const result = renameComponentReferences(
      original,
      names,
      rename,
      own ? 'definition' : 'consumer',
    );
    if (!result.ok) {
      return err({
        code: result.error.code,
        message: `${path.relative(request.projectPath, file)}: ${result.error.message}`,
      });
    }
    if (own || result.value !== original) {
      changes.push({
        file,
        before: own ? request.source : original,
        after: result.value,
      });
    }
  }
  assert(
    changes.some((entry) => sameFilesystemPath(entry.file, request.file)),
    'Rename plan includes the definition',
  );
  return ok(changes);
}
function commitPropertyChanges(changes, noteWrite) {
  assert(
    changes.length <= PROPERTY_LIMITS.filesMax,
    'Property transaction is bounded',
  );
  assert(
    new Set(changes.map((change) => change.file)).size === changes.length,
    'Property transaction writes each file once',
  );
  for (const change of changes) {
    const current = readBoundedSource(change.file);
    if (!current.ok) {
      return current;
    }
    if (current.value !== change.before) {
      return err({
        code: 'conflict',
        message: `${change.file} changed during the rename. Try again.`,
      });
    }
  }
  const written = [];
  for (const change of changes) {
    noteWrite(change.file, change.after);
    const result = writePropertyFile(change.file, change.after);
    if (!result.ok) {
      return rollbackPropertyChanges(written, result.error.message, noteWrite);
    }
    written.push(change);
    const current = readBoundedSource(change.file);
    if (!current.ok) {
      return rollbackPropertyChanges(written, current.error.message, noteWrite);
    }
    assert(
      current.value === change.after,
      'Property write readback matches planned source',
    );
  }
  return ok(undefined);
}
function rollbackPropertyChanges(written, reason, noteWrite) {
  const failed = [];
  for (const change of [...written].reverse()) {
    noteWrite(change.file, change.before);
    const result = writePropertyFile(change.file, change.before);
    if (!result.ok) {
      failed.push(change.file);
    }
  }
  if (failed.length) {
    return err({
      code: 'rollback',
      message: `Save failed and recovery failed for: ${failed.join(', ')}. ${String(reason)}`,
    });
  }
  return err({
    code: 'filesystem',
    message: `Save failed; changes restored. ${String(reason)}`,
  });
}
function planPropertyRemoval(request, change, name) {
  const consumers = readPropertyConsumers(request);
  if (!consumers.ok) {
    return consumers;
  }
  for (const consumer of consumers.value) {
    const result = renameComponentReferences(
      consumer.source,
      consumer.names,
      { from: name, to: '_stackiDeletedProperty' },
      'consumer',
    );
    if (!result.ok) {
      return result;
    }
    if (result.value !== consumer.source) {
      return err({
        code: 'in-use',
        message:
          `${consumer.file} still passes ${name}. ` +
          'Remove that instance value before deleting the prop.',
      });
    }
  }
  return ok([change]);
}
function writePropertyFile(file, source) {
  const temporary = path.join(
    path.dirname(file),
    `.stacki-properties-${randomUUID()}.tmp`,
  );
  try {
    const mode = fs.statSync(file).mode;
    // Same-directory replacement is atomic: failed writes never truncate authored source.
    fs.writeFileSync(temporary, source, { encoding: 'utf8', flag: 'wx', mode });
    fs.renameSync(temporary, file);
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      return err({
        code: 'filesystem',
        message: `Could not save ${file} or remove temporary file ${temporary}: ${String(error)}`,
      });
    }
    return filesystemError(error);
  }
  return ok(undefined);
}
