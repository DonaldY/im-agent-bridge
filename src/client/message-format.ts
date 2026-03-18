import MarkdownIt from 'markdown-it';

type PlatformRenderKind = 'telegram' | 'dingtalk' | 'feishu';

export type ReplyRenderMode = 'ack' | 'progress' | 'final';

export interface ReplyTextOptions {
  mode?: ReplyRenderMode;
}

export interface RenderedReply {
  text: string;
  parseMode?: 'HTML';
  disableWebPagePreview?: boolean;
}

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

function escapeHtmlAttribute(text: string): string {
  return escapeHtml(text).replace(/'/gu, '&#39;');
}

function normalizeReplySource(text: string): string {
  const normalized = String(text || '').replace(/\r\n/gu, '\n').trim();
  return normalized || ' ';
}

function trimEmptyBlockLines(text: string): string {
  return String(text || '')
    .replace(/^[\n]+/gu, '')
    .replace(/[\n]+$/gu, '');
}

function padRight(text: string, width: number): string {
  return `${text}${' '.repeat(Math.max(0, width - text.length))}`;
}

function renderInlinePlain(tokens: any[] = []): string {
  let output = '';
  const links: string[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        output += token.content || '';
        break;
      case 'softbreak':
      case 'hardbreak':
        output += '\n';
        break;
      case 'code_inline':
        output += `\`${token.content || ''}\``;
        break;
      case 'link_open':
        links.push(token.attrGet?.('href') || '');
        break;
      case 'link_close': {
        const href = links.pop() || '';
        if (href) {
          output += ` (${href})`;
        }
        break;
      }
      case 'image': {
        const alt = token.content || token.attrGet?.('alt') || 'image';
        const src = token.attrGet?.('src') || '';
        output += src ? `${alt} (${src})` : alt;
        break;
      }
      case 'html_inline':
        output += token.content || '';
        break;
      default:
        break;
    }
  }

  return output;
}

function renderInlineDisplay(tokens: any[] = []): string {
  let output = '';
  const links: string[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        output += token.content || '';
        break;
      case 'softbreak':
      case 'hardbreak':
        output += '\n';
        break;
      case 'code_inline':
        output += `\`${token.content || ''}\``;
        break;
      case 'strong_open':
        output += '**';
        break;
      case 'strong_close':
        output += '**';
        break;
      case 'em_open':
        output += '_';
        break;
      case 'em_close':
        output += '_';
        break;
      case 's_open':
        output += '~~';
        break;
      case 's_close':
        output += '~~';
        break;
      case 'link_open':
        links.push(token.attrGet?.('href') || '');
        output += '[';
        break;
      case 'link_close': {
        const href = links.pop() || '';
        output += href ? `](${href})` : ']';
        break;
      }
      case 'image': {
        const alt = token.content || token.attrGet?.('alt') || 'image';
        const src = token.attrGet?.('src') || '';
        output += src ? `![${alt}](${src})` : alt;
        break;
      }
      case 'html_inline':
        output += escapeHtml(token.content || '');
        break;
      default:
        break;
    }
  }

  return output;
}

function renderInlineTelegram(tokens: any[] = []): string {
  let output = '';
  const links: string[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        output += escapeHtml(token.content || '');
        break;
      case 'softbreak':
      case 'hardbreak':
        output += '\n';
        break;
      case 'code_inline':
        output += `<code>${escapeHtml(token.content || '')}</code>`;
        break;
      case 'strong_open':
        output += '<b>';
        break;
      case 'strong_close':
        output += '</b>';
        break;
      case 'em_open':
        output += '<i>';
        break;
      case 'em_close':
        output += '</i>';
        break;
      case 's_open':
        output += '<s>';
        break;
      case 's_close':
        output += '</s>';
        break;
      case 'link_open':
        links.push(token.attrGet?.('href') || '');
        output += `<a href="${escapeHtmlAttribute(token.attrGet?.('href') || '')}">`;
        break;
      case 'link_close':
        links.pop();
        output += '</a>';
        break;
      case 'image': {
        const alt = token.content || token.attrGet?.('alt') || 'image';
        const src = token.attrGet?.('src') || '';
        output += src
          ? `<a href="${escapeHtmlAttribute(src)}">${escapeHtml(alt)}</a>`
          : escapeHtml(alt);
        break;
      }
      case 'html_inline':
        output += escapeHtml(token.content || '');
        break;
      default:
        break;
    }
  }

  return output;
}

function findMatchingClose(tokens: any[], start: number): number {
  const open = tokens[start];
  if (!open || open.nesting !== 1) {
    return start;
  }

  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === open.type) {
      depth += 1;
    } else if (token.type === open.type.replace(/_open$/u, '_close')) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return start;
}

function blockquoteText(text: string, kind: PlatformRenderKind): string {
  const normalized = trimEmptyBlockLines(text);
  if (!normalized) {
    return '';
  }

  if (kind === 'telegram') {
    return `<blockquote>${normalized}</blockquote>`;
  }

  return normalized
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function codeBlockText(content: string, info: string, kind: PlatformRenderKind): string {
  const normalized = String(content || '').replace(/\n+$/u, '');
  if (kind === 'telegram') {
    const language = (info || '').trim().split(/\s+/u)[0];
    const className = language ? ` class="language-${escapeHtmlAttribute(language)}"` : '';
    return `<pre><code${className}>${escapeHtml(normalized)}</code></pre>`;
  }

  const fenceInfo = (info || '').trim();
  return fenceInfo
    ? `\`\`\`${fenceInfo}\n${normalized}\n\`\`\``
    : `\`\`\`\n${normalized}\n\`\`\``;
}

function listItemText(text: string, marker: string): string {
  const normalized = trimEmptyBlockLines(text);
  if (!normalized) {
    return `${marker} `;
  }

  const lines = normalized.split('\n');
  const indent = ' '.repeat(marker.length + 1);
  return lines.map((line, index) => `${index === 0 ? `${marker} ` : indent}${line}`).join('\n');
}

function renderAsciiTable(rows: string[][]): string {
  if (rows.length === 0) {
    return '';
  }

  const columnCount = Math.max(...rows.map((row) => row.length));
  const widths = Array.from({ length: columnCount }, (_, columnIndex) => {
    return Math.max(...rows.map((row) => (row[columnIndex] || '').length), 3);
  });

  const formatRow = (row: string[]) => `| ${widths.map((width, index) => padRight(row[index] || '', width)).join(' | ')} |`;
  const divider = `|-${widths.map((width) => '-'.repeat(width)).join('-|-')}-|`;
  const body = rows.slice(1).map(formatRow);
  return [formatRow(rows[0]), divider, ...body].join('\n');
}

function parseTable(tokens: any[], start: number, kind: PlatformRenderKind): { text: string; nextIndex: number } {
  const closeIndex = findMatchingClose(tokens, start);
  const rows: string[][] = [];
  let currentRow: string[] = [];

  for (let index = start + 1; index < closeIndex; index += 1) {
    const token = tokens[index];
    if (token.type === 'tr_open') {
      currentRow = [];
      continue;
    }
    if (token.type === 'tr_close') {
      rows.push(currentRow);
      continue;
    }
    if (token.type === 'th_open' || token.type === 'td_open') {
      const cellClose = findMatchingClose(tokens, index);
      const inlineToken = tokens[index + 1];
      currentRow.push(renderInlinePlain(inlineToken?.children || []).replace(/\n/gu, ' ').trim());
      index = cellClose;
    }
  }

  const asciiTable = renderAsciiTable(rows);
  const text = asciiTable ? codeBlockText(asciiTable, '', kind) : '';
  return { text, nextIndex: closeIndex + 1 };
}

function joinBlocks(blocks: string[]): string {
  return blocks
    .map((block) => trimEmptyBlockLines(block))
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function renderBlocks(tokens: any[], kind: PlatformRenderKind): string {
  const blocks: string[] = [];

  function renderRange(start: number, end: number): string {
    const fragments: string[] = [];
    let index = start;

    while (index < end) {
      const token = tokens[index];

      switch (token.type) {
        case 'heading_open': {
          const closeIndex = findMatchingClose(tokens, index);
          const level = Number(token.tag?.slice(1) || '1');
          const inlineText = renderInlineTelegram(tokens[index + 1]?.children || []);
          if (kind === 'telegram') {
            fragments.push(`${'<b>'}${inlineText}${'</b>'}`);
          } else {
            fragments.push(`${'#'.repeat(Math.max(1, Math.min(level, 6)))} ${renderInlineDisplay(tokens[index + 1]?.children || [])}`);
          }
          index = closeIndex + 1;
          break;
        }
        case 'paragraph_open': {
          const closeIndex = findMatchingClose(tokens, index);
          fragments.push(kind === 'telegram'
            ? renderInlineTelegram(tokens[index + 1]?.children || [])
            : renderInlineDisplay(tokens[index + 1]?.children || []));
          index = closeIndex + 1;
          break;
        }
        case 'blockquote_open': {
          const closeIndex = findMatchingClose(tokens, index);
          const inner = renderRange(index + 1, closeIndex);
          fragments.push(blockquoteText(inner, kind));
          index = closeIndex + 1;
          break;
        }
        case 'bullet_list_open':
        case 'ordered_list_open': {
          const closeIndex = findMatchingClose(tokens, index);
          const ordered = token.type === 'ordered_list_open';
          const startNumber = Number(token.attrGet?.('start') || '1');
          const items: string[] = [];
          let listIndex = startNumber;

          for (let cursor = index + 1; cursor < closeIndex; cursor += 1) {
            if (tokens[cursor].type !== 'list_item_open') {
              continue;
            }

            const itemClose = findMatchingClose(tokens, cursor);
            const marker = ordered ? `${listIndex}.` : '•';
            items.push(listItemText(renderRange(cursor + 1, itemClose), marker));
            listIndex += 1;
            cursor = itemClose;
          }

          fragments.push(items.join('\n'));
          index = closeIndex + 1;
          break;
        }
        case 'fence':
          fragments.push(codeBlockText(token.content || '', token.info || '', kind));
          index += 1;
          break;
        case 'code_block':
          fragments.push(codeBlockText(token.content || '', '', kind));
          index += 1;
          break;
        case 'table_open': {
          const table = parseTable(tokens, index, kind);
          fragments.push(table.text);
          index = table.nextIndex;
          break;
        }
        case 'hr':
          fragments.push(kind === 'telegram' ? '────────' : '---');
          index += 1;
          break;
        case 'inline':
          fragments.push(kind === 'telegram' ? renderInlineTelegram(token.children || []) : renderInlineDisplay(token.children || []));
          index += 1;
          break;
        default:
          index += 1;
          break;
      }
    }

    return joinBlocks(fragments);
  }

  blocks.push(renderRange(0, tokens.length));
  return joinBlocks(blocks);
}

function renderProgressText(text: string): string {
  const normalized = normalizeReplySource(text);
  return normalized === ' ' ? '🤖 正在思考中…' : normalized;
}

export function splitMarkdownBlocks(text: string, maxLength: number): string[] {
  const normalized = normalizeReplySource(text);
  if (normalized === ' ') {
    return [' '];
  }

  const lines = normalized.split('\n');
  const blocks: string[] = [];
  let buffer: string[] = [];
  let fenceMarker = '';

  const flush = () => {
    if (buffer.length === 0) {
      return;
    }
    blocks.push(buffer.join('\n').trim());
    buffer = [];
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/u);
    if (fenceMatch) {
      buffer.push(line);
      if (!fenceMarker) {
        fenceMarker = fenceMatch[1][0];
      } else if (fenceMarker === fenceMatch[1][0]) {
        fenceMarker = '';
      }
      continue;
    }

    if (!fenceMarker && line.trim() === '') {
      flush();
      continue;
    }

    buffer.push(line);
  }
  flush();

  const chunks: string[] = [];
  let current = '';

  for (const block of blocks) {
    if (!current) {
      current = block;
      continue;
    }

    const next = `${current}\n\n${block}`;
    if (next.length <= maxLength) {
      current = next;
      continue;
    }

    chunks.push(current);
    current = block;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.flatMap((chunk) => {
    if (chunk.length <= maxLength) {
      return [chunk];
    }

    const split: string[] = [];
    let remaining = chunk;
    while (remaining.length > maxLength) {
      let boundary = remaining.lastIndexOf('\n', maxLength);
      if (boundary < maxLength * 0.4) {
        boundary = maxLength;
      }
      split.push(remaining.slice(0, boundary).trimEnd());
      remaining = remaining.slice(boundary).trimStart();
    }

    if (remaining) {
      split.push(remaining);
    }

    return split;
  }).filter(Boolean);
}

export function takeStableMarkdownStream(text: string, minLength = 160): { stable: string; rest: string } {
  const normalized = normalizeReplySource(text);
  if (normalized.length < minLength) {
    return { stable: '', rest: normalized === ' ' ? '' : normalized };
  }

  const lines = normalized.split('\n');
  let fenceMarker = '';
  let offset = 0;
  let lastParagraphBoundary = 0;
  let lastLineBoundary = 0;

  for (const line of lines) {
    const lineWithBreak = `${line}\n`;
    const fenceMatch = line.match(/^\s*(```+|~~~+)/u);
    if (fenceMatch) {
      if (!fenceMarker) {
        fenceMarker = fenceMatch[1][0];
      } else if (fenceMarker === fenceMatch[1][0]) {
        fenceMarker = '';
      }
    }

    offset += lineWithBreak.length;

    if (!fenceMarker) {
      lastLineBoundary = offset;
      if (line.trim() === '') {
        lastParagraphBoundary = offset;
      }
    }
  }

  const boundary = lastParagraphBoundary || lastLineBoundary;
  if (!boundary || boundary < minLength) {
    return { stable: '', rest: normalized };
  }

  return {
    stable: normalized.slice(0, boundary).trim(),
    rest: normalized.slice(boundary).trimStart(),
  };
}

export function renderReply(platform: PlatformRenderKind, text: string, options: ReplyTextOptions = {}): RenderedReply {
  const mode = options.mode || 'final';

  if (mode === 'ack' || mode === 'progress') {
    return {
      text: renderProgressText(text),
    };
  }

  const source = normalizeReplySource(text);
  if (source === ' ') {
    return { text: ' ' };
  }

  const tokens = markdown.parse(source, {});
  if (platform === 'telegram') {
    return {
      text: renderBlocks(tokens, 'telegram') || escapeHtml(source),
      parseMode: 'HTML',
      disableWebPagePreview: true,
    };
  }

  return {
    text: renderBlocks(tokens, platform) || source,
  };
}
