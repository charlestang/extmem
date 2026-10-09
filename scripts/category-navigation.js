
'use strict';

// Build the overview from Hexo taxonomy models without changing post categories.
hexo.extend.generator.register('category-overview', function (locals) {
  const categories = locals.categories.toArray();
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const root = hexo.config.root;
  const children = parent => categories.filter(c => String(c.parent || '') === String(parent || '')).sort((a,b) => a.name.localeCompare(b.name, 'zh-CN'));
  const list = parent => '<ul class="category-list">' + children(parent).map(c =>
    `<li class="category-list-item"><a class="category-list-link" href="${escape(root + c.path)}">${escape(c.name)}</a> <span class="category-list-count">${c.posts.length}</span>${children(c._id).length ? list(c._id) : ''}</li>`
  ).join('') + '</ul>';
  return {path: 'categories/index.html', layout: 'page', data: {
    title: '分类', comments: false,
    content: '<p>按原博客分类浏览文章：</p><nav aria-label="文章分类">' + list('') + '</nav>'
  }};
});

// Landscape hides normal menu links on phones. Keep the category entry visible.
hexo.extend.injector.register('head_end', `<style>
@media screen and (max-width: 767px) {
  #main-nav .main-nav-link[href$="/categories/"] { display: block; }
}
</style>`, 'default');
