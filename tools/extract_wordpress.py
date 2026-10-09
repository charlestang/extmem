#!/usr/bin/env python3
"""Read a gzip SQL dump offline; emit only published posts and used taxonomy.

Never execute SQL. Never export users, comments, private posts, or arbitrary options.
"""
import argparse
import gzip
import html
import json
import re
from pathlib import Path


def sql_rows(text):
    i = 0
    while i < len(text):
        while i < len(text) and text[i] != '(':
            i += 1
        if i == len(text):
            return
        i += 1
        values = []
        while i < len(text):
            while text[i].isspace():
                i += 1
            if text[i] == "'":
                i += 1
                value = []
                while i < len(text):
                    c = text[i]
                    i += 1
                    if c == '\\':
                        c = text[i]
                        i += 1
                        value.append({'n': '\n', 'r': '\r', 't': '\t', '0': '\0'}.get(c, c))
                    elif c == "'":
                        if i < len(text) and text[i] == "'":
                            value.append("'")
                            i += 1
                        else:
                            break
                    else:
                        value.append(c)
                value = ''.join(value)
            else:
                start = i
                while i < len(text) and text[i] not in ',)':
                    i += 1
                token = text[start:i].strip()
                value = None if token == 'NULL' else token
            values.append(value)
            while i < len(text) and text[i].isspace():
                i += 1
            sep = text[i]
            i += 1
            if sep == ')':
                break
            if sep != ',':
                raise ValueError('Invalid SQL row separator')
        yield values


def extract(path):
    with gzip.open(path, 'rb') as stream:
        data = stream.read(64 * 1024 * 1024 + 1)
        if len(data) > 64 * 1024 * 1024:
            raise ValueError('Expanded dump exceeds offline inspection limit')
        if stream.read(1):
            raise ValueError('Unexpected extra dump data')
    text = data.decode('utf-8', errors='strict')
    schemas = {}
    for match in re.finditer(r'CREATE TABLE\s+`([^`]+)`\s*\((.*?)\)\s*ENGINE', text, re.S | re.I):
        schemas[match[1]] = re.findall(r'^\s*`([^`]+)`\s', match[2], re.M)
    candidates = [name for name in schemas if name.endswith('_posts')]
    if len(candidates) != 1:
        raise ValueError('Expected exactly one WordPress posts table')
    prefix = candidates[0][:-5]
    allowed = {prefix + name for name in ['posts', 'terms', 'term_taxonomy', 'term_relationships', 'options']}
    tables = {name: [] for name in allowed}
    for match in re.finditer(r'^INSERT INTO\s+`([^`]+)`(?:\s*\(([^)]*)\))?\s+VALUES\s+(.*?);\s*$', text, re.M | re.S | re.I):
        name = match[1]
        if name not in allowed:
            continue
        columns = re.findall(r'`([^`]+)`', match[2]) if match[2] else schemas[name]
        for row in sql_rows(match[3]):
            if len(row) != len(columns):
                raise ValueError('SQL column/value count mismatch')
            tables[name].append(dict(zip(columns, row)))
    options = {d['option_name']: d['option_value'] for d in tables[prefix + 'options']
               if d['option_name'] in ['siteurl', 'home', 'blogname', 'permalink_structure', 'gmt_offset']}
    terms = {d['term_id']: html.unescape(d['name']) for d in tables[prefix + 'terms']}
    taxonomy = {d['term_taxonomy_id']: d for d in tables[prefix + 'term_taxonomy']}
    categories_by_term = {d['term_id']: d for d in taxonomy.values() if d['taxonomy'] == 'category'}
    relations = {}
    for d in tables[prefix + 'term_relationships']:
        relations.setdefault(d['object_id'], []).append(d['term_taxonomy_id'])

    def category_chain(term_id, seen=None):
        seen = set() if seen is None else seen
        if term_id in seen:
            raise ValueError('Cyclic category hierarchy')
        seen.add(term_id)
        category = categories_by_term[term_id]
        parent = category.get('parent', '0')
        chain = category_chain(parent, seen) if parent != '0' and parent in categories_by_term else []
        return chain + [terms[term_id]]

    posts = []
    private_count = 0
    for row in tables[prefix + 'posts']:
        if row['post_type'] != 'post':
            continue
        if row['post_status'] != 'publish':
            private_count += 1
            continue
        categories, tags = [], []
        for taxonomy_id in relations.get(row['ID'], []):
            d = taxonomy[taxonomy_id]
            if d['taxonomy'] == 'category':
                categories.append(category_chain(d['term_id']))
            elif d['taxonomy'] == 'post_tag':
                tags.append(terms[d['term_id']])
        posts.append({
            'id': int(row['ID']), 'title': html.unescape(row['post_title']),
            'date': row['post_date'], 'updated': row['post_modified'],
            'slug': row['post_name'], 'html': row['post_content'],
            'categories': categories, 'tags': tags,
        })
    posts.sort(key=lambda d: d['id'])
    if not posts:
        raise ValueError('No published posts found; refuse empty import')
    return {'site': options, 'excluded_nonpublic_posts': private_count, 'posts': posts}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dump', type=Path)
    args = parser.parse_args()
    print(json.dumps(extract(args.dump), ensure_ascii=False))
