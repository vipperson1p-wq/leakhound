// Исключения: флаг --exclude и файл .vibescanignore.
// Синтаксис — упрощённый .gitignore:
//   dir/          папка на любой глубине
//   /dir или a/b  путь от корня проекта
//   *.min.js      * — любые символы, кроме /;  ** — любое число папок
//   # комментарий
// Отрицания (!pattern) не поддерживаются.

export const IGNORE_FILE = '.vibescanignore';

export function parseIgnoreFile(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('!'));
}

function globToRegex(pattern) {
  let p = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  const dirOnly = p.endsWith('/');
  p = p.replace(/\/+$/, '');
  const anchored = p.startsWith('/') || p.includes('/');
  p = p.replace(/^\/+/, '');

  let body = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      if (p[i + 2] === '/') { body += '(?:.*/)?'; i += 2; } else { body += '.*'; i += 1; }
    } else if (c === '*') body += '[^/]*';
    else if (c === '?') body += '[^/]';
    else body += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${anchored ? '^' : '(?:^|/)'}${body}${dirOnly ? '/' : '(?:/|$)'}`, 'i');
}

// Возвращает функцию (relPath) => true, если файл нужно пропустить
export function compileIgnore(patterns) {
  const regexes = patterns.filter(Boolean).map(globToRegex);
  return (rel) => {
    const p = rel.replace(/\\/g, '/');
    return regexes.some((re) => re.test(p));
  };
}
