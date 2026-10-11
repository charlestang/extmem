import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseHTML} from 'linkedom';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const meta=JSON.parse(fs.readFileSync(path.join(root,'data/published-posts.json'),'utf8'));
const base=meta.publication_root;
const failures=[];
let images=0;
let localImages=0;
function localFile(url) {
  if(!url.startsWith(base))return null;
  const relative=decodeURIComponent(url.slice(base.length).split(/[?#]/)[0]);
  return path.join(root,'public',relative.endsWith('/')?relative+'index.html':relative||'index.html');
}
for(const post of meta.posts){
  const file=path.join(root,'public/archives',`${post.id}.html`);
  if(!fs.existsSync(file)){failures.push(`Missing post ${post.id}`);continue;}
  const {document}=parseHTML(fs.readFileSync(file,'utf8'));
  const article=document.querySelector('.article-entry');
  if(!article){failures.push(`Missing article body ${post.id}`);continue;}
  if(document.querySelector('#comments,#disqus_thread,.giscus,.vcomment'))failures.push(`Unexpected comments ${post.id}`);
  for(const node of document.querySelectorAll('a[href],img[src],link[href],script[src]')){
    const attribute=node.hasAttribute('href')?'href':'src';const url=node.getAttribute(attribute);
    if(url.startsWith('/')&&!url.startsWith('//')&&!url.startsWith(base))failures.push(`Unprefixed local URL in ${post.id}: ${url}`);
    const local=localFile(url);
    // Links to non-article pages that were absent in the selected SQL remain documented legacy links.
    if(local&&(url.includes('/images/')||url.includes('/css/')||url.includes('/js/')||url.includes('/categories/')||url.includes('/tags/')||/\/archives\/\d+\.html/.test(url))&&!fs.existsSync(local))failures.push(`Missing static target in ${post.id}: ${url}`);
  }
  images+=article.querySelectorAll('img').length;
  localImages+=Array.from(article.querySelectorAll('img[src]')).filter(n=>n.getAttribute('src').startsWith(base+'images/')).length;
}
const sourceNames=fs.readdirSync(path.join(root,'source/_posts')).filter(n=>n.endsWith('.md'));
const allowedIDs=new Set(meta.posts.map(p=>p.id));
for(const name of sourceNames){const m=name.match(/^(\d+)-/);if(m&&!allowedIDs.has(Number(m[1])))failures.push(`Unexpected legacy post ID ${m[1]}`);}
if(images!==meta.image_elements)failures.push(`Image element count changed: ${images}`);
if(localImages!==meta.local_image_elements)failures.push(`Local image count changed: ${localImages}`);
if(!fs.existsSync(path.join(root,'public/index.html')))failures.push('Missing homepage');
console.log(JSON.stringify({published_legacy_posts:meta.posts.length,image_elements:images,local_image_elements:localImages,failures},null,2));
if(failures.length)process.exitCode=1;
