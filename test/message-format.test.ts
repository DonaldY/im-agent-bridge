import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReply, splitMarkdownBlocks, takeStableMarkdownStream } from '../src/client/message-format';

test('renderReply for telegram supports rich markdown features', () => {
  const rendered = renderReply('telegram', [
    '# 标题',
    '',
    '> 引用 `inline`',
    '',
    '- 列表项',
    '',
    '| A | B |',
    '| - | - |',
    '| 1 | 2 |',
    '',
    '混合 **加粗 _斜体_** 和 ~~删除线~~ 以及 [链接](https://example.com)',
    '',
    '```ts',
    'const x = 1 < 2;',
    '```',
    '',
    '<b>escape</b>',
  ].join('\n'));

  assert.equal(rendered.parseMode, 'HTML');
  assert.match(rendered.text, /<b>标题<\/b>/u);
  assert.match(rendered.text, /<blockquote>引用 <code>inline<\/code><\/blockquote>/u);
  assert.match(rendered.text, /• 列表项/u);
  assert.match(rendered.text, /<pre><code>\| A/u);
  assert.match(rendered.text, /<b>加粗 <i>斜体<\/i><\/b>/u);
  assert.match(rendered.text, /<s>删除线<\/s>/u);
  assert.match(rendered.text, /<a href="https:\/\/example.com">链接<\/a>/u);
  assert.match(rendered.text, /const x = 1 &lt; 2;/u);
  assert.match(rendered.text, /&lt;b&gt;escape&lt;\/b&gt;/u);
});

test('renderReply for dingtalk keeps readable markdown semantics', () => {
  const rendered = renderReply('dingtalk', '## 小标题\n\n- **粗体**\n- _斜体_\n- ~~删除~~\n\n`code`');

  assert.match(rendered.text, /^## 小标题/um);
  assert.match(rendered.text, /• \*\*粗体\*\*/u);
  assert.match(rendered.text, /• _斜体_/u);
  assert.match(rendered.text, /• ~~删除~~/u);
  assert.match(rendered.text, /`code`/u);
});

test('renderReply handles empty input and nested styles', () => {
  assert.equal(renderReply('feishu', '').text, ' ');

  const rendered = renderReply('telegram', '**outer _inner_**');
  assert.match(rendered.text, /<b>outer <i>inner<\/i><\/b>/u);
});

test('splitMarkdownBlocks respects paragraph boundaries', () => {
  const chunks = splitMarkdownBlocks('第一段\n\n第二段\n\n第三段', 6);
  assert.deepEqual(chunks, ['第一段', '第二段', '第三段']);
});

test('takeStableMarkdownStream avoids cutting inside fenced blocks', () => {
  const pending = ['第一段', '', '```js', 'const x = 1;', '```', '', '第二段'].join('\n');
  const result = takeStableMarkdownStream(pending, 4);

  assert.match(result.stable, /```js/u);
  assert.equal(result.rest, '第二段');
});
