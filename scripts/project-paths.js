/* Keep article assets and internal links correct when hosted below a project path. */
'use strict';
const { parseHTML } = require('linkedom');

hexo.extend.filter.register('after_post_render', function (data) {
  const root = '/' + String(hexo.config.root || '/').replace(/^\/+|\/+$/g, '') + '/';
  if (root === '//') return data;
  const rewrite = value => {
    if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith(root)) return value;
    return root + value.replace(/^\/+/, '');
  };
  const render = html => {
    if (!html) return html;
    const { document } = parseHTML(`<html><body>${html}</body></html>`);
    for (const node of document.querySelectorAll('[href],[src],[poster],[data-src],[data-original],[data-lazy-src],[srcset],[data-srcset],[style]')) {
      for (const attribute of ['href', 'src', 'poster', 'data-src', 'data-original', 'data-lazy-src']) {
        if (node.hasAttribute(attribute)) node.setAttribute(attribute, rewrite(node.getAttribute(attribute)));
      }
      for (const attribute of ['srcset', 'data-srcset']) {
        if (node.hasAttribute(attribute)) node.setAttribute(attribute, node.getAttribute(attribute).split(',').map(candidate => {
          const [url, ...descriptor] = candidate.trim().split(/\s+/);
          return [rewrite(url), ...descriptor].join(' ');
        }).join(', '));
      }
      if (node.hasAttribute('style')) node.setAttribute('style', node.getAttribute('style').replace(/url\((['"]?)(\/[^\)'"]*)\1\)/g, (_, quote, url) => `url(${quote}${rewrite(url)}${quote})`));
    }
    return document.body.innerHTML;
  };
  for (const field of ['content', 'excerpt', 'more']) if (data[field]) data[field] = render(data[field]);
  return data;
}, 20);
