/**
 * @kvd/clipper — format + unique filename + Node write into vault `01-收件箱/`.
 * Browser extension (`apps/clipper`) mirrors the format helpers via File System Access API.
 */
export { CLIP_INBOX_DIR, CLIP_TAG } from './constants.js';
export {
  formatClipMarkdown,
  formatClippedAt,
  yamlDoubleQuoted,
  yamlLiteralBlock,
  type ClipPayload,
} from './format.js';
export {
  sanitizeClipTitle,
  localDateStamp,
  clipFilenameBase,
  allocateUniqueClipFilename,
} from './filename.js';
export {
  writeClipToInbox,
  assertClipInboxRel,
  type WriteClipInput,
  type WriteClipResult,
} from './write.js';
