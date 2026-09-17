// Use the full project path: different folders can contain the same filename.
export function componentPreviewUrl(devUrl, component, trailingSlash) {
  const path = [
    component.isLayout ? 'src' : 'src/components',
    component.folder,
    `${component.name}.astro`,
  ].filter(Boolean).join('/');
  const query = new URLSearchParams({ c: component.name, p: path });
  const route = trailingSlash === 'always' ? '/__avb/preview/' : '/__avb/preview';
  return `${devUrl.replace(/\/+$/, '')}${route}?${query}`;
}
