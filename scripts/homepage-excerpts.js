// Preserve authored excerpts; provide a safe presentation-only fallback for long posts.
'use strict';
const {parseHTML} = require('linkedom');
const escapeText = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
hexo.extend.filter.register('after_post_render', function (data) {
  if (data.layout !== 'post' || data.excerpt) return data;
  const {document} = parseHTML(`<html><body>${data.content}</body></html>`);
  for (const node of document.querySelectorAll('script,style,iframe,object,embed')) node.remove();
  const text = document.body.textContent.replace(/\s+/g, ' ').trim();
  const characters = Array.from(text);
  if (characters.length <= 240) return data;
  data.excerpt = `<p>${escapeText(characters.slice(0, 200).join(''))}…</p>`;
  // The theme's existing read-more URL uses #more; keep that target in the full page.
  data.content = '<span id="more"></span>' + data.content;
  return data;
}, 30);
