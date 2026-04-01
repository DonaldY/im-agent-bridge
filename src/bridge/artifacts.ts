import fs from 'node:fs/promises';
import path from 'node:path';
import type { OutgoingAttachment } from '../client/types.js';
import { toErrorMessage } from '../utils.js';

interface RawAttachmentManifestEntry {
  kind?: string;
  path?: string;
  name?: string;
  mimeType?: string;
}

interface RawAttachmentManifest {
  attachments?: RawAttachmentManifestEntry[];
}

const MAX_ATTACHMENTS_PER_TURN = 3;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_BYTES = 30 * 1024 * 1024;

const EXTENSION_MIME_TYPES: Record<string, string> = {
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
};

function isRelativeTo(baseDir: string, targetPath: string): boolean {
  const relativePath = path.relative(baseDir, targetPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function normalizeMimeType(value?: string): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.split(';')[0].trim().toLowerCase();
  return normalized || undefined;
}

function inferMimeType(filePath: string): string | undefined {
  return EXTENSION_MIME_TYPES[path.extname(filePath).toLowerCase()];
}

function attachmentSizeLimit(kind: OutgoingAttachment['kind']): number {
  return kind === 'image' ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
}

function attachmentSizeLabel(kind: OutgoingAttachment['kind']): string {
  return kind === 'image' ? '10MB' : '30MB';
}

export function buildOutgoingArtifactsPrompt(outputDir: string, manifestPath: string): string {
  return [
    '如果用户明确要求把图片或文件发回当前 IM 会话，请使用附件回传协议。',
    `附件输出目录：${outputDir}`,
    `附件清单路径：${manifestPath}`,
    '要求：',
    '1. 先把需要回传的文件写入附件输出目录。',
    '2. 再创建 manifest.json，格式为 {"attachments":[{"kind":"image"|"file","path":"相对或绝对路径","name":"文件名","mimeType":"可选 MIME"}]}。',
    '3. 只有真正生成成功并写入 manifest.json 的文件，桥接层才会回传到 IM。',
    '4. 如果本轮不需要回传附件，不要创建 manifest.json。',
    '5. 不要在回复文本中声称“已发送附件”，除非你已经完成以上步骤。',
  ].join('\n');
}

export async function loadOutgoingAttachments(
  outputDir: string,
  manifestPath: string,
): Promise<{ attachments: OutgoingAttachment[]; errors: string[] }> {
  let rawManifest: string;

  try {
    rawManifest = await fs.readFile(manifestPath, 'utf8');
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === 'ENOENT') {
      return { attachments: [], errors: [] };
    }
    return {
      attachments: [],
      errors: [`附件清单读取失败：${toErrorMessage(error)}`],
    };
  }

  let parsed: RawAttachmentManifest;
  try {
    parsed = JSON.parse(rawManifest) as RawAttachmentManifest;
  } catch (error) {
    return {
      attachments: [],
      errors: [`附件清单格式无效：${toErrorMessage(error)}`],
    };
  }

  const entries = Array.isArray(parsed.attachments) ? parsed.attachments : [];
  const attachments: OutgoingAttachment[] = [];
  const errors: string[] = [];

  if (entries.length > MAX_ATTACHMENTS_PER_TURN) {
    errors.push(`单轮最多回传 ${MAX_ATTACHMENTS_PER_TURN} 个附件，超出部分已忽略。`);
  }

  for (const [index, entry] of entries.slice(0, MAX_ATTACHMENTS_PER_TURN).entries()) {
    const kind = entry?.kind === 'image' || entry?.kind === 'file' ? entry.kind : null;
    if (!kind) {
      errors.push(`附件 #${index + 1} 缺少有效 kind。`);
      continue;
    }

    const declaredPath = typeof entry.path === 'string' ? entry.path.trim() : '';
    if (!declaredPath) {
      errors.push(`附件 #${index + 1} 缺少有效 path。`);
      continue;
    }

    const resolvedPath = path.resolve(outputDir, declaredPath);
    if (!isRelativeTo(outputDir, resolvedPath)) {
      errors.push(`附件 #${index + 1} 路径越界：${declaredPath}`);
      continue;
    }

    let stats;
    try {
      stats = await fs.stat(resolvedPath);
    } catch (error) {
      errors.push(`附件 #${index + 1} 不存在：${toErrorMessage(error)}`);
      continue;
    }

    if (!stats.isFile()) {
      errors.push(`附件 #${index + 1} 不是文件：${resolvedPath}`);
      continue;
    }

    const sizeLimit = attachmentSizeLimit(kind);
    if (stats.size <= 0) {
      errors.push(`附件 #${index + 1} 为空文件：${resolvedPath}`);
      continue;
    }
    if (stats.size > sizeLimit) {
      errors.push(`附件 #${index + 1} 超出大小限制（${attachmentSizeLabel(kind)}）：${resolvedPath}`);
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = await fs.readFile(resolvedPath);
    } catch (error) {
      errors.push(`附件 #${index + 1} 读取失败：${toErrorMessage(error)}`);
      continue;
    }

    const mimeType = normalizeMimeType(entry.mimeType) || inferMimeType(resolvedPath);
    const fileName = typeof entry.name === 'string' && entry.name.trim()
      ? entry.name.trim()
      : path.basename(resolvedPath);

    attachments.push({
      kind,
      buffer,
      fileName,
      sizeBytes: stats.size,
      mimeType,
      filePath: resolvedPath,
    });
  }

  return { attachments, errors };
}
