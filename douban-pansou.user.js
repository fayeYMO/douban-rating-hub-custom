// ==UserScript==
// @name         豆瓣条目自动搜盘(so.252035.xyz)
// @namespace    https://www.douban.com/people/206232091/
// @version      1.0.0
// @description  访问豆瓣电影/剧集条目页时,自动在 PanSou 盘搜(so.252035.xyz)查询该片是否有网盘资源,并在评分框下方显示"是否存在 + 结果数量 + 直达链接"
// @author       Chan
// @match        https://movie.douban.com/subject/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      so.252035.xyz
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const API = 'https://so.252035.xyz/api/search';
  const SITE = 'https://so.252035.xyz/';
  const CACHE_TTL_HIT = 24 * 60 * 60 * 1000;  // 有结果:缓存 24 小时
  const CACHE_TTL_MISS = 60 * 60 * 1000;      // 无结果:只缓存 1 小时(新片收录后自动更新,且站点后台已爬完、重查更快)
  const PREFERRED_TYPES = ['quark', 'baidu']; // 优先网盘:有夸克/百度就只显示这两类,都没有才显示其余
  const PREVIEW_COUNT = 3;               // 默认展示前几条结果
  const ENABLED_KEY = 'pansou_enabled';  // 全局开关,所有豆瓣页面共用,跨会话记住
  let enabled = GM_getValue(ENABLED_KEY, true);

  // 只在条目主页运行,排除 /comments、/photos、/reviews 等子页面
  const m = location.pathname.match(/^\/subject\/(\d+)\/?$/);
  if (!m) return;
  const subjectId = m[1];

  // 取标题:豆瓣 h1 形如 "布拉瓦岛 Brava"。实测盘搜对纯中文关键词命中率最好
  // (带原名如 "杂技师 L'acrobate" 反而可能出错或查不到),所以取中文段为主关键词,
  // 完整标题作为 0 结果时的后备关键词。
  const titleEl = document.querySelector('#content h1 span[property="v:itemreviewed"]');
  if (!titleEl) return;
  const fullTitle = titleEl.textContent.trim();
  const firstSeg = fullTitle.split(/\s+/)[0] || fullTitle;
  const kwMain = /[\u4e00-\u9fff]/.test(firstSeg) ? firstSeg : fullTitle;
  const kwAlt = kwMain === fullTitle ? '' : fullTitle;

  const TYPE_LABEL = {
    aliyun: '阿里云盘', quark: '夸克网盘', baidu: '百度网盘',
    tianyi: '天翼云盘', uc: 'UC网盘', mobile: '移动云盘',
    xunlei: '迅雷云盘', '115': '115网盘', '123': '123云盘',
    pikpak: 'PikPak', magnet: '磁力', others: '其他'
  };

  // ---------- 卡片 UI(插在评分框 #interest_sectl 下方) ----------
  const card = document.createElement('div');
  // 无边框无底色,模仿豆瓣条目页原生小节(如"剧情简介")的观感
  card.style.cssText = 'margin:20px 0;font-size:13px;line-height:1.9;color:#333;';
  const anchor = document.querySelector('#interest_sectl');
  if (anchor && anchor.parentNode) {
    anchor.parentNode.insertBefore(card, anchor.nextSibling);
  } else {
    const aside = document.querySelector('#content .aside') || document.querySelector('#content');
    if (aside) aside.appendChild(card); else return;
  }

  const head = document.createElement('div');
  head.style.cssText = 'font-weight:bold;color:#007722;';
  head.textContent = '🔍 盘搜资源 ';
  const status = document.createElement('span');
  status.style.fontWeight = 'normal';
  head.appendChild(status);
  card.appendChild(head);

  const body = document.createElement('div');
  card.appendChild(body);

  // ---------- 开关 ----------
  function setEnabled(v) {
    enabled = v;
    GM_setValue(ENABLED_KEY, v);
    if (v) run(false); else renderDisabled();
  }

  function renderDisabled() {
    status.style.color = '#bbb';
    status.textContent = '已关闭';
    body.textContent = '';
    const div = document.createElement('div');
    div.style.color = '#999';
    div.textContent = '自动查询已停用 ';
    div.appendChild(actionBtn('开启', () => setEnabled(true)));
    body.appendChild(div);
  }

  function addClose(ops) {
    ops.appendChild(document.createTextNode(' '));
    ops.appendChild(actionBtn('关闭自动查询', () => setEnabled(false)));
  }

  function linkEl(href, text) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    a.target = '_blank';
    a.rel = 'noopener noreferrer nofollow';
    return a;
  }

  function actionBtn(text, onClick) {
    const a = document.createElement('a');
    a.href = 'javascript:;';
    a.textContent = text;
    a.style.color = '#37a';
    a.addEventListener('click', onClick);
    return a;
  }

  function itemRow(it) {
    const div = document.createElement('div');
    const note = it.note.length > 50 ? it.note.slice(0, 50) + '…' : it.note;
    const a = linkEl(it.url, note);
    a.style.color = '#37a';
    div.appendChild(a);
    const meta = [];
    if (it.pwd) meta.push('提取码 ' + it.pwd);
    if (it.date) meta.push(it.date);
    if (meta.length) {
      const span = document.createElement('span');
      span.style.color = '#999';
      span.textContent = '  (' + meta.join(' · ') + ')';
      span.title = it.src;
      div.appendChild(span);
    }
    return div;
  }

  // ---------- 查询 ----------
  function apiSearch(kw, refresh) {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: 'GET',
        // res/src 与前端请求保持一致,后端行为和浏览器里搜索完全相同
        url: API + '?kw=' + encodeURIComponent(kw) + '&res=merge&src=all' + (refresh ? '&refresh=true' : ''),
        timeout: 90000, // 新关键词站点要现场爬源,实测首查可达 1 分钟以上
        headers: { Accept: 'application/json' },
        onload: (r) => {
          try {
            const json = JSON.parse(r.responseText);
            if (json.code !== 0) return resolve({ ok: false, err: json.message || '接口返回异常' });
            resolve({ ok: true, res: extract(json.data) });
          } catch (e) {
            // 部分关键词(如带原名的标题)会返回空响应体,按 0 条处理而不是报错
            resolve({ ok: true, res: { total: 0, counts: {}, items: [] } });
          }
        },
        onerror: () => resolve({ ok: false, err: '网络错误' }),
        ontimeout: () => resolve({ ok: false, err: '查询超时' })
      });
    });
  }

  function extract(data) {
    const groups = (data && data.merged_by_type) || {};
    const items = [];
    const seen = new Set();
    for (const [type, arr] of Object.entries(groups)) {
      const list = Array.isArray(arr) ? arr : [];
      for (const it of list) {
        const url = it && it.url;
        if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
        seen.add(url);
        items.push({
          type: type,
          url: url,
          note: ((it.note || '(无标题)') + '').trim(),
          pwd: (it.password || '').trim(),
          date: (it.datetime || '').slice(0, 10),
          src: it.source || ''
        });
      }
    }
    // 按去重后的实际条目统计各类型数量
    const counts = {};
    items.forEach((it) => { counts[it.type] = (counts[it.type] || 0) + 1; });

    // 有夸克/百度网盘结果就只显示这两类,都没有才回落到迅雷等其余类型
    const preferred = items.filter((it) => PREFERRED_TYPES.indexOf(it.type) !== -1);
    let total = items.length;
    let shownItems = items;
    let shownCounts = counts;
    if (preferred.length) {
      shownItems = preferred;
      shownCounts = {};
      PREFERRED_TYPES.forEach((t) => { if (counts[t]) shownCounts[t] = counts[t]; });
      total = preferred.length;
    }
    return { total: total, counts: shownCounts, items: shownItems, kwUsed: '', filtered: shownItems !== items };
  }

  // ---------- 渲染 ----------
  let expanded = false;
  let lastRes = null;

  function renderCounts(counts) {
    const keys = Object.keys(counts);
    if (!keys.length) return null;
    const div = document.createElement('div');
    keys.forEach((k, i) => {
      const span = document.createElement('span');
      span.style.cssText = 'background:#f4f4f4;border-radius:3px;padding:0 6px;margin-right:6px;';
      span.textContent = (TYPE_LABEL[k] || k) + ' ×' + counts[k];
      div.appendChild(span);
    });
    return div;
  }

  function renderResult(res) {
    body.textContent = '';
    if (res.filtered) {
      const note = document.createElement('div');
      note.style.color = '#999';
      note.textContent = '已优先显示夸克/百度网盘,其余类型(迅雷等)已隐藏';
      body.appendChild(note);
    }
    const counts = renderCounts(res.counts);
    if (counts) body.appendChild(counts);

    const list = document.createElement('div');
    list.style.marginTop = '4px';
    const shown = expanded ? res.items : res.items.slice(0, PREVIEW_COUNT);
    shown.forEach((it) => list.appendChild(itemRow(it)));
    body.appendChild(list);

    const ops = document.createElement('div');
    ops.style.marginTop = '4px';
    if (res.items.length > PREVIEW_COUNT) {
      ops.appendChild(actionBtn(expanded ? '收起' : '展开全部 ' + res.items.length + ' 条', () => {
        expanded = !expanded;
        renderResult(lastRes);
      }));
      ops.appendChild(document.createTextNode('  '));
    }
    ops.appendChild(actionBtn('强制刷新', () => run(true)));
    ops.appendChild(document.createTextNode('  '));
    ops.appendChild(linkEl(SITE, '打开盘搜 ↗'));
    addClose(ops);
    body.appendChild(ops);
  }

  function renderError(err) {
    body.textContent = '';
    const div = document.createElement('div');
    div.style.color = '#999';
    div.textContent = '原因:' + err;
    body.appendChild(div);
    const ops = document.createElement('div');
    ops.appendChild(actionBtn('重试', () => run(true)));
    ops.appendChild(document.createTextNode('  '));
    ops.appendChild(linkEl(SITE, '打开盘搜手动搜 ↗'));
    addClose(ops);
    body.appendChild(ops);
  }

  // ---------- 主流程 ----------
  async function run(refresh) {
    if (!enabled) { renderDisabled(); return; }
    expanded = false;
    const cacheKey = 'pansou_' + subjectId;
    if (!refresh) {
      const c = GM_getValue(cacheKey);
      const ttl = c && c.data && c.data.total > 0 ? CACHE_TTL_HIT : CACHE_TTL_MISS;
      if (c && c.kwMain === kwMain && Date.now() - c.t < ttl) {
        lastRes = c.data;
        status.style.color = c.data.total > 0 ? '#070' : '#999';
        status.textContent = c.data.total > 0 ? '✓ 找到 ' + c.data.total + ' 条(缓存)' : '✗ 未找到资源(缓存)';
        renderResult(c.data);
        return;
      }
    }

    status.style.color = '#999';
    status.textContent = '查询中:「' + kwMain + '」…';
    body.textContent = '';

    let r = await apiSearch(kwMain, refresh);
    r.res.kwUsed = kwMain;
    if (r.ok && r.res.total === 0 && kwAlt) {
      const r2 = await apiSearch(kwAlt, refresh);
      if (r2.ok) {
        r2.res.kwUsed = kwAlt;
        r = r2;
      }
    }

    if (!enabled) return; // 查询期间被关闭,丢弃结果
    if (!r.ok) {
      status.style.color = '#c60';
      status.textContent = '⚠ 查询失败';
      renderError(r.err);
      return;
    }

    GM_setValue(cacheKey, { t: Date.now(), kwMain: kwMain, data: r.res });
    lastRes = r.res;
    if (r.res.total > 0) {
      status.style.color = '#070';
      status.textContent = '✓ 找到 ' + r.res.total + ' 条';
      renderResult(r.res);
    } else {
      status.style.color = '#999';
      status.textContent = '✗ 未找到资源';
      body.textContent = '';
      const div = document.createElement('div');
      div.style.color = '#999';
      div.textContent = '搜索关键词:「' + r.res.kwUsed + '」;新片可能尚未被收录,1 小时后访问会自动重查';
      body.appendChild(div);
      const ops = document.createElement('div');
      ops.appendChild(actionBtn('强制刷新', () => run(true)));
      ops.appendChild(document.createTextNode('  '));
      ops.appendChild(linkEl(SITE, '打开盘搜手动搜 ↗'));
      addClose(ops);
      body.appendChild(ops);
    }
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand(enabled ? '关闭盘搜自动查询' : '开启盘搜自动查询', () => setEnabled(!enabled));
  }
  if (enabled) run(false); else renderDisabled();
})();
