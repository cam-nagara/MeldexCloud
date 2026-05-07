/* ==============================
   数式エンジン（Notion互換サブセット）
   gb-database.js から分離
   ============================== */

// トークナイザ
function formulaTokenize(src) {
  const tokens = []; let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    // コメント /* ... */
    if (ch === '/' && src[i+1] === '*') { const end = src.indexOf('*/', i+2); i = end < 0 ? src.length : end + 2; continue; }
    // 文字列
    if (ch === '"') {
      const start = i;
      let s = ''; i++;
      while (i < src.length && src[i] !== '"') { if (src[i] === '\\') { i++; s += src[i] || ''; } else { s += src[i]; } i++; }
      i++; tokens.push({type:'str', value:s, pos:start, end:i}); continue;
    }
    // 数値
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i+1]||''))) {
      const start = i;
      let n = ''; while (i < src.length && /[0-9.]/.test(src[i])) { n += src[i]; i++; }
      tokens.push({type:'num', value: parseFloat(n), pos:start, end:i}); continue;
    }
    // 識別子・キーワード
    if (/[a-zA-Z_\u3000-\u9fff\uff00-\uffef]/.test(ch)) {
      const start = i;
      let id = ''; while (i < src.length && /[a-zA-Z0-9_\u3000-\u9fff\uff00-\uffef]/.test(src[i])) { id += src[i]; i++; }
      if (id === 'true') tokens.push({type:'bool', value:true, pos:start, end:i});
      else if (id === 'false') tokens.push({type:'bool', value:false, pos:start, end:i});
      else tokens.push({type:'id', value:id, pos:start, end:i});
      continue;
    }
    // 2文字演算子
    const two = src.substring(i, i+2);
    if (['>=','<=','==','!=','&&','||'].includes(two)) { tokens.push({type:'op', value:two, pos:i, end:i+2}); i+=2; continue; }
    // 1文字
    tokens.push({type:'op', value:ch, pos:i, end:i+1}); i++;
  }
  return tokens;
}

// パーサー（再帰下降）
function formulaParse(tokens) {
  let pos = 0;
  function peek() { return tokens[pos] || null; }
  function next() { return tokens[pos++] || null; }
  function parseError(message, token) {
    const err = new Error(message);
    if (token && Number.isFinite(token.pos)) err.formulaPos = token.pos;
    return err;
  }
  function expect(type, value) {
    const t = next();
    if (!t || (type && t.type !== type) || (value !== undefined && t.value !== value))
      throw parseError('Expected ' + (value||type) + ' but got ' + (t ? t.value : 'EOF'), t || tokens[pos - 1] || tokens[tokens.length - 1]);
    return t;
  }

  function parseExpr() { return parseOr(); }

  function parseOr() {
    let left = parseAnd();
    while (peek()?.value === '||') { next(); left = {type:'binary', op:'||', left, right:parseAnd()}; }
    return left;
  }
  function parseAnd() {
    let left = parseComparison();
    while (peek()?.value === '&&') { next(); left = {type:'binary', op:'&&', left, right:parseComparison()}; }
    return left;
  }
  function parseComparison() {
    let left = parseAddSub();
    while (peek() && ['==','!=','>','<','>=','<='].includes(peek().value)) {
      const op = next().value; left = {type:'binary', op, left, right:parseAddSub()};
    }
    return left;
  }
  function parseAddSub() {
    let left = parseMulDiv();
    while (peek() && ['+','-'].includes(peek().value)) {
      const op = next().value; left = {type:'binary', op, left, right:parseMulDiv()};
    }
    return left;
  }
  function parseMulDiv() {
    let left = parseUnary();
    while (peek() && ['*','/'].includes(peek().value)) {
      const op = next().value; left = {type:'binary', op, left, right:parseUnary()};
    }
    return left;
  }
  function parseUnary() {
    if (peek()?.value === '-') { next(); return {type:'unary', op:'-', expr:parseUnary()}; }
    if (peek()?.value === '!') { next(); return {type:'unary', op:'!', expr:parseUnary()}; }
    return parsePrimary();
  }
  function parsePrimary() {
    const t = peek();
    if (!t) throw parseError('Unexpected end', tokens[tokens.length - 1]);
    if (t.type === 'num') { next(); return {type:'literal', value:t.value}; }
    if (t.type === 'str') { next(); return {type:'literal', value:t.value}; }
    if (t.type === 'bool') { next(); return {type:'literal', value:t.value}; }
    if (t.type === 'op' && t.value === '(') { next(); const e = parseExpr(); expect('op', ')'); return e; }
    if (t.type === 'id') {
      const name = next().value;
      if (peek()?.value === '(') {
        next(); // (
        const args = [];
        let needsComma = false;
        while (peek() && peek().value !== ')') {
          if (needsComma) {
            if (peek()?.value !== ',') throw parseError('Expected ,', peek() || tokens[pos - 1]);
            next();
          }
          args.push(parseExpr());
          needsComma = true;
        }
        expect('op', ')');
        return {type:'call', name, args};
      }
      return {type:'var', name};
    }
    throw parseError('Unexpected token: ' + t.value, t);
  }

  const ast = parseExpr();
  if (peek()) {
    throw parseError('Unexpected token: ' + peek().value, peek());
  }
  return ast;
}

// 評価器
function formulaEval(ast, ctx) {
  if (!ast) return '';
  switch (ast.type) {
    case 'literal': return ast.value;
    case 'var': return ctx.vars?.[ast.name] ?? '';
    case 'unary':
      if (ast.op === '-') return -toNum(formulaEval(ast.expr, ctx));
      if (ast.op === '!') return !toBool(formulaEval(ast.expr, ctx));
      return '';
    case 'binary': {
      // 短絡評価: &&, || は左辺のみ先に評価
      if (ast.op === '&&') { const lv = formulaEval(ast.left, ctx); return toBool(lv) ? formulaEval(ast.right, ctx) : lv; }
      if (ast.op === '||') { const lv = formulaEval(ast.left, ctx); return toBool(lv) ? lv : formulaEval(ast.right, ctx); }
      const lv = formulaEval(ast.left, ctx), rv = formulaEval(ast.right, ctx);
      switch (ast.op) {
        case '+': return (typeof lv === 'string' || typeof rv === 'string') ? String(lv) + String(rv) : toNum(lv) + toNum(rv);
        case '-': return toNum(lv) - toNum(rv);
        case '*': return toNum(lv) * toNum(rv);
        case '/': { const d = toNum(rv); return d === 0 ? 0 : toNum(lv) / d; }
        case '>': return _formulaCompare(lv, rv, '>');
        case '<': return _formulaCompare(lv, rv, '<');
        case '>=': return _formulaCompare(lv, rv, '>=');
        case '<=': return _formulaCompare(lv, rv, '<=');
        case '==': return String(lv) === String(rv);
        case '!=': return String(lv) !== String(rv);
      }
      return '';
    }
    case 'call': return formulaCallFn(ast.name, ast.args, ctx);
    default: return '';
  }
}

function toNum(v) { if (typeof v === 'number') return isFinite(v) ? v : 0; if (typeof v === 'boolean') return v ? 1 : 0; const n = parseFloat(v); return isFinite(n) ? n : 0; }
function toBool(v) {
  if (v === '' || v === 0 || v === false || v === null || v === undefined) return false;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (!t) return false;
    if (['false', '0', 'no', 'off', 'いいえ'].includes(t)) return false;
    if (['true', '1', 'yes', 'on', 'はい'].includes(t)) return true;
  }
  return true;
}

function _formulaDateMs(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  if (Number.isNaN(d.getTime())) return null;
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
  return d.getTime();
}

function _formulaDateObj(v) {
  const ms = _formulaDateMs(v);
  return ms === null ? null : new Date(ms);
}

function _formulaPad(v, len = 2) {
  return String(v).padStart(len, '0');
}

function _formulaDateValueFromDate(date, withTime) {
  const y = date.getFullYear();
  const m = _formulaPad(date.getMonth() + 1);
  const d = _formulaPad(date.getDate());
  if (!withTime) return y + '-' + m + '-' + d;
  return y + '-' + m + '-' + d + 'T' + _formulaPad(date.getHours()) + ':' + _formulaPad(date.getMinutes()) + ':' + _formulaPad(date.getSeconds());
}

function _formulaFormatDate(date, pattern) {
  const yy = String(date.getFullYear());
  const replacements = {
    YYYY: yy,
    yyyy: yy,
    YY: yy.slice(-2),
    yy: yy.slice(-2),
    MM: _formulaPad(date.getMonth() + 1),
    M: String(date.getMonth() + 1),
    DD: _formulaPad(date.getDate()),
    dd: _formulaPad(date.getDate()),
    D: String(date.getDate()),
    d: String(date.getDate()),
    HH: _formulaPad(date.getHours()),
    H: String(date.getHours()),
    mm: _formulaPad(date.getMinutes()),
    m: String(date.getMinutes()),
    ss: _formulaPad(date.getSeconds()),
    s: String(date.getSeconds()),
  };
  return String(pattern).replace(/YYYY|yyyy|YY|yy|MM|M|DD|dd|D|d|HH|H|mm|m|ss|s/g, token => replacements[token] ?? token);
}

function _formulaIsNumberLike(v) {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v !== 'string') return false;
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim());
}

function _formulaFormatNumber(value, pattern) {
  const fmt = String(pattern || '');
  const percent = fmt.includes('%');
  const scaled = percent ? value * 100 : value;
  const decimalMatch = fmt.match(/\.(.*?)(?:%|$)/);
  const decimals = decimalMatch ? (decimalMatch[1].match(/[0#]/g) || []).length : 0;
  const grouped = fmt.includes(',');
  let text = Number.isFinite(scaled) ? scaled.toFixed(decimals) : '0';
  if (grouped) {
    const parts = text.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    text = parts.join('.');
  }
  return percent ? text + '%' : text;
}

function _formulaFormatValue(value, pattern) {
  if (value === null || value === undefined) return '';
  const fmt = pattern == null ? '' : String(pattern);
  if (!fmt) return String(value);
  const d = _formulaDateObj(value);
  if (d && /Y|y|M|D|d|H|m|s/.test(fmt)) return _formulaFormatDate(d, fmt);
  if (_formulaIsNumberLike(value) && /[0#]/.test(fmt)) return _formulaFormatNumber(toNum(value), fmt);
  return String(value);
}

function _formulaNormalizeDateUnit(unit) {
  const u = String(unit || 'days').trim().toLowerCase();
  if (['year', 'years', 'y', '年'].includes(u)) return 'years';
  if (['month', 'months', 'mo', '月'].includes(u)) return 'months';
  if (['week', 'weeks', 'w', '週'].includes(u)) return 'weeks';
  if (['hour', 'hours', 'h', '時', '時間'].includes(u)) return 'hours';
  if (['minute', 'minutes', 'min', 'mins', '分'].includes(u)) return 'minutes';
  if (['second', 'seconds', 'sec', 'secs', '秒'].includes(u)) return 'seconds';
  return 'days';
}

function _formulaAddMonths(date, months) {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

function _formulaTrunc(value) {
  return value < 0 ? Math.ceil(value) : Math.floor(value);
}

function _formulaDateBetween(endValue, startValue, unitValue) {
  const end = _formulaDateObj(endValue);
  const start = _formulaDateObj(startValue);
  if (!end || !start) return 0;
  const unit = _formulaNormalizeDateUnit(unitValue);
  const diffMs = end.getTime() - start.getTime();
  if (unit === 'years' || unit === 'months') {
    let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    const anchor = _formulaAddMonths(start, months);
    if (months > 0 && anchor > end) months -= 1;
    if (months < 0 && anchor < end) months += 1;
    return unit === 'years' ? _formulaTrunc(months / 12) : months;
  }
  const unitMs = {
    weeks: 7 * 86400000,
    days: 86400000,
    hours: 3600000,
    minutes: 60000,
    seconds: 1000,
  }[unit] || 86400000;
  return _formulaTrunc(diffMs / unitMs);
}

function _formulaDateShift(value, amount, unitValue) {
  const date = _formulaDateObj(value);
  if (!date) return '';
  const unit = _formulaNormalizeDateUnit(unitValue);
  const delta = toNum(amount);
  let shifted = new Date(date.getTime());
  if (unit === 'years') shifted = _formulaAddMonths(shifted, delta * 12);
  else if (unit === 'months') shifted = _formulaAddMonths(shifted, delta);
  else if (unit === 'weeks') shifted.setDate(shifted.getDate() + delta * 7);
  else if (unit === 'days') shifted.setDate(shifted.getDate() + delta);
  else if (unit === 'hours') shifted.setHours(shifted.getHours() + delta);
  else if (unit === 'minutes') shifted.setMinutes(shifted.getMinutes() + delta);
  else shifted.setSeconds(shifted.getSeconds() + delta);
  const originalText = typeof value === 'string' ? value.trim() : '';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(originalText);
  return _formulaDateValueFromDate(shifted, !dateOnly);
}

function _formulaCompare(lv, rv, op) {
  const ld = _formulaDateMs(lv);
  const rd = _formulaDateMs(rv);
  const l = ld !== null && rd !== null ? ld : toNum(lv);
  const r = ld !== null && rd !== null ? rd : toNum(rv);
  if (op === '>') return l > r;
  if (op === '<') return l < r;
  if (op === '>=') return l >= r;
  if (op === '<=') return l <= r;
  return false;
}

function _formulaPickEntityValue(vals) {
  if (!Array.isArray(vals) || vals.length === 0) return null;
  if (typeof getAdoptedValueForWrite === 'function') {
    const target = getAdoptedValueForWrite(vals);
    if (target) return target;
  }
  const adopted = vals.find(v => {
    const status = v?.status || '採用';
    return status === '採用' || status === '掲載済み';
  });
  if (adopted) return adopted;
  return vals.find(v => (v?.status || '採用') !== 'ボツ') || null;
}

function formulaCallFn(name, args, ctx) {
  const ev = (a) => formulaEval(a, ctx);

  switch (name) {
    case 'prop': {
      const pname = ev(args[0]);
      const vals = ctx.entity?.[pname];
      if (!vals || vals.length === 0) return '';
      const target = _formulaPickEntityValue(vals);
      const raw = target?.value;
      return raw !== undefined && raw !== null ? raw : '';
    }
    case 'if': return toBool(ev(args[0])) ? ev(args[1]) : (args[2] ? ev(args[2]) : '');
    case 'and': return args.every(a => toBool(ev(a)));
    case 'or': return args.some(a => toBool(ev(a)));
    case 'not': return !toBool(ev(args[0]));
    case 'empty': { const v = ev(args[0]); return v === '' || v === null || v === undefined; }
    case 'contains': { const s = String(ev(args[0])), sub = String(ev(args[1])); return s.includes(sub); }
    case 'replace': { const s = String(ev(args[0])), from = String(ev(args[1])), to = String(ev(args[2])); return s.split(from).join(to); }
    case 'floor': return Math.floor(toNum(ev(args[0])));
    case 'ceil': return Math.ceil(toNum(ev(args[0])));
    case 'round': return Math.round(toNum(ev(args[0])));
    case 'abs': return Math.abs(toNum(ev(args[0])));
    case 'mod': { const a = toNum(ev(args[0])), b = toNum(ev(args[1])); return b === 0 ? 0 : a % b; }
    case 'toNumber': return toNum(ev(args[0]));
    case 'format': { const v = ev(args[0]); return _formulaFormatValue(v, args[1] ? ev(args[1]) : ''); }
    case 'length': { const v = ev(args[0]); return typeof v === 'string' ? v.length : 0; }
    case 'concat': return args.map(a => String(ev(a))).join('');
    case 'min': { const nums = args.map(a => toNum(ev(a))); return nums.length === 0 ? 0 : Math.min(...nums); }
    case 'max': { const nums = args.map(a => toNum(ev(a))); return nums.length === 0 ? 0 : Math.max(...nums); }
    case 'now': return _formulaDateValueFromDate(new Date(), true);
    case 'year': { const d = _formulaDateObj(ev(args[0])); return d ? d.getFullYear() : 0; }
    case 'month': { const d = _formulaDateObj(ev(args[0])); return d ? d.getMonth() + 1 : 0; }
    case 'day': { const d = _formulaDateObj(ev(args[0])); return d ? d.getDate() : 0; }
    case 'dateBetween': return _formulaDateBetween(ev(args[0]), ev(args[1]), args[2] ? ev(args[2]) : 'days');
    case 'dateSubtract': return _formulaDateShift(ev(args[0]), -toNum(ev(args[1])), args[2] ? ev(args[2]) : 'days');
    case 'dateAdd': return _formulaDateShift(ev(args[0]), toNum(ev(args[1])), args[2] ? ev(args[2]) : 'days');
    case 'let': case 'lets': {
      const newVars = { ...(ctx.vars || {}) };
      let i = 0;
      while (i < args.length - 1) {
        if (args[i].type === 'var' || args[i].type === 'literal') {
          const vname = args[i].type === 'var' ? args[i].name : String(formulaEval(args[i], ctx));
          const vval = formulaEval(args[i+1], {...ctx, vars: newVars});
          newVars[vname] = vval;
          i += 2;
        } else break;
      }
      return formulaEval(args[args.length - 1], {...ctx, vars: newVars});
    }
    default: return '';
  }
}

// 数式をコンパイル（パース結果をキャッシュ）
const _formulaCache = Object.create(null);
function formulaCompile(src) {
  if (Object.prototype.hasOwnProperty.call(_formulaCache, src)) return _formulaCache[src];
  try {
    const tokens = formulaTokenize(src);
    const ast = formulaParse(tokens);
    _formulaCache[src] = { ast, error: null };
  } catch (e) {
    _formulaCache[src] = {
      ast: null,
      error: e.message,
      errorPos: Number.isFinite(e.formulaPos) ? e.formulaPos : null,
    };
  }
  return _formulaCache[src];
}

// エントリの全プロパティ値を使って数式を評価
function formulaEvalForEntity(formulaSrc, entityData) {
  const compiled = formulaCompile(formulaSrc);
  if (compiled.error) return { value: '', error: compiled.error, errorPos: compiled.errorPos ?? null };
  try {
    const result = formulaEval(compiled.ast, { entity: entityData, vars: {} });
    return { value: result, error: null };
  } catch (e) {
    return { value: '', error: e.message };
  }
}
