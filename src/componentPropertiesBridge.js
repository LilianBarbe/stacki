import {
  parsePropertyLocation,
  parsePropertyRequest,
} from '../shared/component-properties.mjs';
import {
  parseComponentProperties,
  parsePropertiesResult,
} from '../shared/component-properties.mjs';
export async function readComponentProperties(projectPath, file) {
  const payload = parsePropertyLocation({ projectPath, file });
  const result = await window.avb.componentProperties(payload);
  return parsePropertiesResult(result, parseComponentProperties);
}
export async function editComponentProperties(
  projectPath,
  file,
  source,
  change,
) {
  const payload = parsePropertyRequest({
    projectPath,
    file,
    source,
    change,
  });
  const result = await window.avb.editComponentProperties(payload);
  return parsePropertiesResult(result, parseComponentProperties);
}
