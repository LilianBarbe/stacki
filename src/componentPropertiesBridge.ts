import { parseIpcPayload } from '../shared/ipc-payloads';
import { parseComponentProperties, parsePropertiesResult } from '../shared/component-properties';
import type { ComponentProperties, PropertyChange } from '../shared/component-properties';
import type { Result } from '../shared/result';

export async function readComponentProperties(
  projectPath: string,
  file: string
): Promise<Result<ComponentProperties>> {
  const payload = parseIpcPayload('component:properties', { projectPath, file });
  const result: unknown = await window.avb.componentProperties(payload);
  return parsePropertiesResult(result, parseComponentProperties);
}
export async function editComponentProperties(
  projectPath: string,
  file: string,
  source: string,
  change: PropertyChange
): Promise<Result<ComponentProperties>> {
  const payload = parseIpcPayload('component:editProperties', {
    projectPath,
    file,
    source,
    change,
  });
  const result: unknown = await window.avb.editComponentProperties(payload);
  return parsePropertiesResult(result, parseComponentProperties);
}
