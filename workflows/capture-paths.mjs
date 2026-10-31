import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const captureRoot = fileURLToPath(new URL('../captures/', import.meta.url));

export function isWithin(root, directory) {
  const relative = path.relative(path.resolve(root), path.resolve(directory));
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

export function assertCapturePath(directory) {
  const absolute = path.resolve(directory);
  const desktop = path.join(os.homedir(), 'Desktop');
  if (absolute === desktop || isWithin(desktop, absolute)) {
    throw Error(`Capture files must stay off the Desktop. Use a unique directory under ${captureRoot}`);
  }
  return absolute;
}
