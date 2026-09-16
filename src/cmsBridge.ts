import type { Result } from '../shared/result';
import type { Parser } from '../shared/boundary';
import type { DeclaredTypes } from './panels/cmsTypes';
import {
  boolean,
  data,
  dictionary,
  list,
  object,
  pathText,
  record,
  text,
} from '../shared/boundary';
import { parseIpcPayload } from '../shared/ipc-payloads';
import { cleanError } from './cleanError';
import { parseDeclaredTypes } from './panels/cmsTypes';

export function parseCmsRead(input: unknown) {
  const value = record(input);
  if (!Object.hasOwn(value, 'data')) {
    throw new Error('CMS read: missing data');
  }
  return { data: data(value['data']) };
}
export const parseCmsMeta = object({ meta: dictionary(parseDeclaredTypes) });
export const parseCmsUsage = object({ files: list(pathText) });
export function parseCmsSuccess(input: unknown): void {
  const value = record(input);
  if (!boolean(value['ok'])) {
    throw new Error('CMS result: expected success');
  }
}
export function parseCmsAsset(input: unknown) {
  const value = record(input);
  if (value['value'] !== undefined) {
    return text(value['value']);
  }
  return { __expr: text(value['name']), __asset: pathText(value['asset']) };
}
async function cmsRequest<Value>(
  invoke: () => Promise<unknown>,
  parse: Parser<Value>,
): Promise<Result<Value, string>> {
  let response: unknown;
  try {
    response = await invoke();
  } catch (error: unknown) {
    return { ok: false, error: cleanError(error) };
  }
  // A broken contract is not a disk failure. Parse outside the operating-error catch.
  return { ok: true, value: parse(response) };
}
export function readCms(projectPath: string, rel: string) {
  const payload = parseIpcPayload('cms:read', { projectPath, rel });
  return cmsRequest(() => window.avb.readCms(payload), parseCmsRead);
}
export function readCmsMeta(projectPath: string) {
  const payload = parseIpcPayload('cms:meta', projectPath);
  return cmsRequest(() => window.avb.cmsMeta(payload), parseCmsMeta);
}
export function writeCms(projectPath: string, rel: string, value: unknown) {
  const payload = parseIpcPayload('cms:write', { projectPath, rel, data: value });
  return cmsRequest(() => window.avb.writeCms(payload), parseCmsSuccess);
}
export function writeCmsMeta(projectPath: string, rel: string, fields: DeclaredTypes) {
  const payload = parseIpcPayload('cms:setMeta', { projectPath, rel, fields });
  return cmsRequest(() => window.avb.setCmsMeta(payload), parseCmsSuccess);
}
export function readCmsUsage(projectPath: string, rel: string) {
  const payload = parseIpcPayload('cms:usage', { projectPath, rel });
  return cmsRequest(() => window.avb.cmsUsage(payload), parseCmsUsage);
}
export function deleteCms(projectPath: string, rel: string) {
  const payload = parseIpcPayload('cms:delete', { projectPath, rel });
  return cmsRequest(
    () => window.avb.deleteCms(payload),
    (response) => {
      parseCmsSuccess(response);
      return list(pathText)(record(response)['rewritten']);
    },
  );
}
export function importCmsAsset(projectPath: string, rel: string, assetRel: string) {
  const payload = parseIpcPayload('cms:assetRef', { projectPath, rel, assetRel });
  return cmsRequest(() => window.avb.cmsAssetRef(payload), parseCmsAsset);
}
