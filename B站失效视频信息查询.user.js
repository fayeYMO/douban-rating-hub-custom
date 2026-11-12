// ==UserScript==
// @name         B站失效视频信息查询
// @namespace    zcode.bili.deadvideo
// @version      1.0.2
// @description  打开被删除/失效的B站视频页时,自动从 BiliPlus、唧唧Down 缓存、Wayback Machine 等来源找回标题、UP主、封面、简介、播放数据,并拦截失效页3秒自动跳回首页;任意B站页面可通过悬浮球手动输入 av/BV 号查询。
// @author       faye
// @match        https://www.bilibili.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      api.bilibili.com
// @connect      biliplus.com
// @connect      jijidown.com
// @connect      archive.org
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  if (typeof GM_xmlhttpRequest === 'undefined') {
    console.warn('[失效视频查询] 需要 Tampermonkey 提供的 GM_xmlhttpRequest');
    return;
  }

  /* ==================== 常量 ==================== */

  const SOURCE_DEFS = [
    { key: 'official', name: 'B站官方接口' },
    { key: 'jijidown', name: '唧唧Down 缓存' },
    { key: 'biliplus', name: 'BiliPlus 缓存' },
    { key: 'wayback',  name: 'Wayback Machine' },
  ];

  // 官方接口各失效状态码的含义(2026-11 实测 -404 与 62002 仍常见)
  const DEAD_CODE_HINTS = {
    '-404':  '啥都木有——视频已被删除、设为仅自己可见,或审核未通过',
    '-403':  '无权访问——可能仅UP主自己可见',
    '-352':  '被风控拦截,请稍后再试',
    '-412':  '请求被拦截,请稍后再试',
    '62002': '稿件不可见——通常已被删除或违规下架',
    '62004': '稿件审核中,可能稍后恢复可见',
    '62012': '仅UP主自己可见',
  };

  // BV <-> av(通用算法,新旧号段通吃;经 av2↔BV1xx411c7mD 与多组 2025-10 后新版号实测验证)
  const AV_TABLE = 'FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf';
  const AV_XOR = 23442827791579n;
  const AV_MASK = 2251799813685247n;
  const AV_BASE = 58n;

  const CACHE_TTL = 6 * 3600 * 1000;

  /* ==================== 失效页防跳转 ==================== */
  // 实测(2026-11):失效视频页在初始化时挂一个约3秒的定时器,到点后整页
  // location 跳回首页(落地URL带 spm_id_from=333.788.selfDef.errorpage),
  // 无 meta refresh、不走路由。对策:document-start 先于页面脚本接管
  // setTimeout/setInterval 并记录 id,官方接口确认失效后:
  //   1) 清掉已挂的页面定时器(拆除已武装的跳转);
  //   2) 进入丢弃模式——失效页上新挂的页面定时器一律静默丢弃(防重新武装);
  //   3) 拦截 history.pushState/replaceState 离开失效页的路由跳转,
  //      用户1.5秒内有真实点击则放行,避免卡死正常导航。

  const deadPages = new Set();       // 已确认失效的视频页 pathname(小写)
  let redirectDisarmed = false;
  let lastUserClickAt = 0;
  const pageTimerIds = new Set();    // 页面脚本(主世界)挂的定时器 id
  const uw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const origSetTimeout = uw.setTimeout;
  const origSetInterval = uw.setInterval;

  function currentVideoKey() {
    const m = location.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10}|av\d+)/i);
    return m ? m[1].toLowerCase() : null;
  }

  function isDeadVideoPage() {
    const key = currentVideoKey();
    return key !== null && deadPages.has(key);
  }

  uw.setTimeout = function (fn, delay, ...rest) {
    if (redirectDisarmed && isDeadVideoPage()) {
      return origSetTimeout.call(uw, function () {}, 1e9); // 静默丢弃,不执行页面回调
    }
    const id = origSetTimeout.call(uw, fn, delay, ...rest);
    pageTimerIds.add(id);
    return id;
  };
  uw.setInterval = function (fn, delay, ...rest) {
    if (redirectDisarmed && isDeadVideoPage()) {
      return origSetInterval.call(uw, function () {}, 1e9);
    }
    const id = origSetInterval.call(uw, fn, delay, ...rest);
    pageTimerIds.add(id);
    return id;
  };

  document.addEventListener('click', function () { lastUserClickAt = Date.now(); }, true);

  function guardHistoryMethod(orig) {
    return function (state, title, url) {
      if (isDeadVideoPage() && Date.now() - lastUserClickAt > 1500 && url != null) {
        try {
          const target = new URL(String(url), location.href);
          if (target.pathname !== location.pathname) {
            console.log('[失效视频查询] 已拦截失效页的路由跳转:', target.pathname);
            return undefined;
          }
        } catch (e) { /* url 无法解析则放行 */ }
      }
      return orig.call(uw.history, state, title, url);
    };
  }
  try {
    uw.history.pushState = guardHistoryMethod(uw.history.pushState);
    uw.history.replaceState = guardHistoryMethod(uw.history.replaceState);
  } catch (e) { /* 个别环境不可写,放弃该防线 */ }

  function disarmRedirect() {
    if (redirectDisarmed) return;
    redirectDisarmed = true;
    const key = currentVideoKey();
    if (key) deadPages.add(key);
    let cleared = 0;
    for (const id of pageTimerIds) {
      if (id === pageWatcherId) continue; // 别误杀自己的页面监听
      try { uw.clearTimeout(id); uw.clearInterval(id); cleared++; } catch (e) { /* 忽略 */ }
    }
    pageTimerIds.clear();
    try {
      const meta = document.querySelector('meta[http-equiv="refresh" i]');
      if (meta && meta.parentNode) meta.parentNode.removeChild(meta);
    } catch (e) { /* 忽略 */ }
    console.log('[失效视频查询] 已拦截本页自动跳转(清除页面定时器 ' + cleared + ' 个)');
  }

  /* ==================== 通用工具 ==================== */

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'style') node.style.cssText = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    (children || []).forEach((c) => node.appendChild(c));
    return node;
  }

  function gmFetch(url, timeout = 12000) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout,
        headers: { Accept: 'application/json, text/plain, */*' },
        onload: (res) => {
          if (res.status >= 200 && res.status < 300) resolve(res.responseText);
          else reject(new Error('HTTP ' + res.status));
        },
        onerror: () => reject(new Error('网络请求失败')),
        ontimeout: () => reject(new Error('请求超时')),
      });
    });
  }

  async function gmJson(url, timeout) {
    const text = await gmFetch(url, timeout);
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error('返回内容不是JSON(可能被站点拦截)');
    }
  }

  function fmtTime(sec) {
    const n = Number(sec);
    if (!n || isNaN(n)) return '';
    return new Date(n * 1000).toLocaleString('zh-CN', { hour12: false });
  }

  function fmtNum(n) {
    n = Number(n);
    if (isNaN(n)) return '';
    return n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + '万' : String(n);
  }

  function toSecLen(v) {
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v === 'number') return v;
    const parts = String(v).split(':').map(Number).filter((x) => !isNaN(x));
    if (!parts.length) return undefined;
    return parts.reduce((a, b) => a * 60 + b, 0);
  }

  function parseId(text) {
    text = String(text || '').trim();
    let m = text.match(/[Bb][Vv][0-9A-Za-z]{10}/);
    if (m) return { type: 'bvid', val: 'BV' + m[0].slice(2) };
    m = text.match(/[Aa][Vv](\d{1,20})/);
    if (m) return { type: 'aid', val: m[1] };
    m = text.match(/^(\d{1,15})$/);
    if (m) return { type: 'aid', val: m[1] };
    return null;
  }

  function displayId(id) {
    return id.type === 'bvid' ? id.val : 'av' + id.val;
  }

  function pageUrlOf(id) {
    return 'https://www.bilibili.com/video/' + displayId(id);
  }

  /* ==================== BV号 <-> av号 ==================== */

  function bvidToAid(bvid) {
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return null;
    const arr = Array.from(bvid);
    [arr[3], arr[9]] = [arr[9], arr[3]];
    [arr[4], arr[7]] = [arr[7], arr[4]];
    let tmp = 0n;
    for (let i = 3; i < 12; i++) {
      const idx = AV_TABLE.indexOf(arr[i]);
      if (idx < 0) return null;
      tmp = tmp * AV_BASE + BigInt(idx);
    }
    const aid = (tmp & AV_MASK) ^ AV_XOR;
    if (aidToBvid(aid) !== bvid) return null; // 回环校验,拒绝乱码输入
    return Number(aid); // aid < 2^51 < 2^53,Number 精度安全
  }

  function aidToBvid(aid) {
    let tmp = ((1n << 51n) | BigInt(aid)) ^ AV_XOR;
    const chars = [];
    while (tmp > 0n) {
      chars.push(AV_TABLE[Number(tmp % AV_BASE)]);
      tmp /= AV_BASE;
    }
    while (chars.length < 9) chars.push(AV_TABLE[0]);
    chars.reverse();
    const arr = ('BV1' + chars.join('')).split('');
    [arr[3], arr[9]] = [arr[9], arr[3]];
    [arr[4], arr[7]] = [arr[7], arr[4]];
    return arr.join('');
  }

  /* ==================== 数据源 ==================== */

  async function srcOfficial(id) {
    const url = id.type === 'bvid'
      ? 'https://api.bilibili.com/x/web-interface/view?bvid=' + id.val
      : 'https://api.bilibili.com/x/web-interface/view?aid=' + id.val;
    const j = await gmJson(url);
    if (j && j.code === 0 && j.data) {
      const d = j.data;
      return {
        status: 'ok',
        alive: true,
        info: {
          title: d.title,
          pic: d.pic,
          desc: d.desc,
          ownerName: d.owner && d.owner.name,
          ownerMid: d.owner && d.owner.mid,
          pubdate: d.pubdate || d.ctime,
          duration: d.duration,
          videos: d.videos,
          tname: d.tname,
          view: d.stat && d.stat.view,
          danmaku: d.stat && d.stat.danmaku,
          reply: d.stat && d.stat.reply,
          like: d.stat && d.stat.like,
          coin: d.stat && d.stat.coin,
          favorite: d.stat && d.stat.favorite,
          share: d.stat && d.stat.share,
        },
        raw: d,
      };
    }
    const code = j && j.code;
    return {
      status: 'empty',
      note: DEAD_CODE_HINTS[String(code)] || ('官方接口返回 ' + code + ' ' + ((j && j.message) || '')),
    };
  }

  async function srcBiliPlus(id) {
    let aid;
    if (id.type === 'aid') {
      aid = id.val;
    } else {
      aid = bvidToAid(id.val);
      if (aid === null) {
        return { status: 'empty', note: 'BV号无效,无法换算为av号,已跳过' };
      }
    }
    const j = await gmJson('https://www.biliplus.com/api/view?id=' + aid, 15000);
    if (j && typeof j.code === 'number' && j.code !== 0) {
      return {
        status: 'empty',
        note: j.code === -404 ? 'BiliPlus 数据库无此视频的缓存' : 'BiliPlus 返回 ' + j.code + ' ' + (j.message || ''),
      };
    }
    const d = j && (typeof j.data === 'object' && j.data !== null ? j.data : j);
    if (!d || !d.title) {
      return { status: 'empty', note: 'BiliPlus 无缓存数据' };
    }
    return {
      status: 'ok',
      info: {
        title: d.title,
        pic: d.pic,
        desc: d.description || d.desc,
        ownerName: d.author || (d.owner && d.owner.name),
        ownerMid: d.mid || (d.owner && d.owner.mid),
        pubdate: d.created,
        duration: toSecLen(d.length !== undefined ? d.length : d.duration),
        videos: Array.isArray(d.list) ? d.list.length : undefined,
        tname: d.typename,
        view: d.play,
        danmaku: d.video_review,
        reply: d.review,
        favorite: d.favorites,
        coin: d.coins,
        tags: d.tag ? String(d.tag).split(',') : undefined,
        cacheDate: d.lastupdate,
      },
      raw: d,
    };
  }

  async function srcJijidown(id) {
    let aid;
    if (id.type === 'aid') {
      aid = id.val;
    } else {
      aid = bvidToAid(id.val);
      if (aid === null) return { status: 'empty', note: 'BV号无效,无法换算为av号,已跳过' };
    }
    const j = await gmJson('https://www.jijidown.com/api/v1/video/get_info?id=' + aid, 15000);
    if (!j || j.code || !j.title) {
      return { status: 'empty', note: '唧唧Down 无缓存数据' };
    }
    if (j.msg === 'loading') {
      // 首次查询新版号会触发其后台抓取,先返回占位
      return { status: 'empty', note: '唧唧Down 正在后台抓取该视频,稍后点"重新查询"' };
    }
    return {
      status: 'ok',
      info: {
        title: j.title,
        pic: j.img,
        desc: j.desc ? String(j.desc).replace(/<br\s*\/?>/gi, '\n') : undefined,
        ownerName: j.up && j.up.author,
        ownerMid: j.upid,
        pubdate: j.btime,
        view: j.play,
        favorite: j.favos,
        coin: j.coins,
        tname: j.subsort,
        tags: Array.isArray(j.tags) ? j.tags : undefined,
        cacheDate: j.ltime ? fmtTime(j.ltime) : undefined,
      },
      raw: j,
    };
  }

  async function srcWayback(id) {
    const target = pageUrlOf(id);
    const j = await gmJson('https://archive.org/wayback/available?url=' + encodeURIComponent(target), 8000);
    const snap = j && j.archived_snapshots && j.archived_snapshots.closest;
    if (!snap || !snap.url) return { status: 'empty', note: 'Wayback 无存档快照' };
    return { status: 'ok', note: '有存档快照(' + snap.timestamp + ')', link: snap.url };
  }

  /* ==================== 结果合并与缓存 ==================== */

  const MERGE_PRIORITY = ['official', 'jijidown', 'biliplus'];

  function mergeInfo(sources) {
    const merged = {};
    for (const key of MERGE_PRIORITY) {
      const s = sources[key];
      if (!s || s.status !== 'ok' || !s.info) continue;
      for (const [k, v] of Object.entries(s.info)) {
        if (v !== undefined && v !== null && v !== '' && merged[k] === undefined) merged[k] = v;
      }
    }
    return merged;
  }

  function cacheKeyOf(id) {
    return 'biliDeadQ:' + displayId(id);
  }

  function readCache(id) {
    try {
      const s = sessionStorage.getItem(cacheKeyOf(id));
      if (!s) return null;
      const o = JSON.parse(s);
      if (!o || Date.now() - o.ts > CACHE_TTL) return null;
      return o;
    } catch (e) {
      return null;
    }
  }

  function writeCache(id, payload) {
    try {
      sessionStorage.setItem(cacheKeyOf(id), JSON.stringify(Object.assign({ ts: Date.now() }, payload)));
    } catch (e) { /* 存不了就算了 */ }
  }

  /* ==================== 查询编排 ==================== */

  let querySeq = 0;
  let current = null; // { token, id, alive, sources, merged, finished }
  let panelShown = false;

  async function runSource(key, fn, token) {
    if (!current || current.token !== token) return;
    current.sources[key] = { status: 'pending' };
    render();
    try {
      const r = await fn(current.id);
      if (!current || current.token !== token) return;
      current.sources[key] = r;
    } catch (e) {
      if (!current || current.token !== token) return;
      current.sources[key] = { status: 'fail', error: (e && e.message) || String(e) };
    }
    render();
  }

  async function startQuery(id, opts = {}) {
    const token = ++querySeq;
    current = { token, id, alive: null, sources: {}, merged: null, finished: false };
    if (opts.manual) panelShown = true;
    render();

    await runSource('official', srcOfficial, token);
    if (!current || current.token !== token) return;
    const off = current.sources.official;
    current.alive = !!(off && off.status === 'ok' && off.alive);

    if (current.alive) {
      current.merged = (off && off.info) || null;
      current.finished = true;
      render();
      writeCache(id, { dead: false });
      return;
    }

    disarmRedirect(); // 官方确认失效:先拆掉本页3秒自动跳回首页的定时器
    if (!opts.manual) panelShown = true;
    render();

    await Promise.all([
      runSource('jijidown', srcJijidown, token),
      runSource('biliplus', srcBiliPlus, token),
      runSource('wayback', srcWayback, token),
    ]);
    if (!current || current.token !== token) return;
    current.merged = mergeInfo(current.sources);
    current.finished = true;
    render();
    writeCache(id, { dead: true, query: snapshot() });
  }

  function snapshot() {
    return {
      id: current.id,
      alive: current.alive,
      sources: current.sources,
      merged: current.merged,
      finished: true,
    };
  }

  function autoCheck(id) {
    const c = readCache(id);
    if (c) {
      if (c.dead && c.query) {
        current = Object.assign({ token: ++querySeq }, c.query);
        disarmRedirect();
        panelShown = true;
        render();
      }
      return;
    }
    startQuery(id);
  }

  /* ==================== 界面 ==================== */

  let root = null;
  let contentEl = null;

  const CSS = [
    '#bili-dead-panel{position:fixed;top:14px;right:14px;z-index:2147483647;width:350px;max-height:82vh;overflow:auto;background:#fff;color:#222;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.28);font:13px/1.6 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}',
    '.bdp-head{display:flex;align-items:center;gap:8px;font-weight:600;padding:10px 12px 0}',
    '.bdp-close{margin-left:auto;cursor:pointer;color:#999;padding:0 4px;font-weight:400}',
    '.bdp-close:hover{color:#333}',
    '.bdp-manual{display:flex;gap:6px;margin:8px 12px 0}',
    '.bdp-input{flex:1;border:1px solid #ddd;border-radius:6px;padding:4px 8px;font-size:12px;outline:none;min-width:0}',
    '.bdp-input:focus{border-color:#fb7299}',
    '.bdp-btn{border:none;background:#fb7299;color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;white-space:nowrap;font-size:12px}',
    '.bdp-btn:hover{background:#e45c86}',
    '.bdp-btn-re{background:#fff;color:#fb7299;border:1px solid #fb7299}',
    '.bdp-status{border-radius:8px;padding:6px 10px;margin:8px 12px;background:#f5f5f5}',
    '.bdp-dead{background:#fdeaea;color:#c0392b}',
    '.bdp-ok{background:#e8f7ee;color:#1e8e4e}',
    '.bdp-card{border:1px solid #eee;border-radius:8px;padding:8px;margin:0 12px 8px}',
    '.bdp-cover{width:100%;border-radius:6px;margin-bottom:6px;display:block}',
    '.bdp-title{font-weight:600;font-size:14px;margin-bottom:4px;word-break:break-all}',
    '.bdp-meta{color:#666;margin-bottom:4px}',
    '.bdp-stats{display:flex;flex-wrap:wrap;gap:4px 10px;color:#666;margin-bottom:4px}',
    '.bdp-tags{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px}',
    '.bdp-tag{background:#f1f2f3;border-radius:4px;padding:0 6px;font-size:11px;color:#666}',
    '.bdp-desc{white-space:pre-wrap;color:#444;border-top:1px dashed #eee;padding-top:4px;margin-top:4px;max-height:120px;overflow:auto}',
    '.bdp-cacheinfo{color:#999;font-size:11px;margin-top:4px}',
    '.bdp-sources{margin:0 12px 8px}',
    '.bdp-sources details{border:1px solid #eee;border-radius:6px;margin-bottom:4px;padding:2px 6px}',
    '.bdp-sources summary{cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.bdp-raw{max-height:180px;overflow:auto;font-size:11px;background:#fafafa;padding:6px;border-radius:4px;white-space:pre-wrap;word-break:break-all}',
    '.bdp-links{display:flex;flex-wrap:wrap;gap:6px;margin:0 12px 8px}',
    '.bdp-link{color:#00a1d6;text-decoration:none;border:1px solid #cfeef7;border-radius:6px;padding:2px 8px;font-size:12px}',
    '.bdp-link:hover{background:#e6f7fd}',
    '.bdp-actions{display:flex;gap:6px;margin:0 12px 12px}',
    '#bili-dead-ball{position:fixed;bottom:28px;right:28px;z-index:2147483646;width:46px;height:46px;border-radius:50%;background:#fb7299;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 14px rgba(251,114,153,.5);font:12px/1.3 "Microsoft YaHei",sans-serif;user-select:none;text-align:center}',
    '#bili-dead-ball:hover{transform:scale(1.06)}',
  ].join('\n');

  function ensureUI() {
    if (root) return;
    if (!document.body) {
      // document-start阶段body尚未就绪,等DOM就绪后再建界面
      document.addEventListener('DOMContentLoaded', function () { ensureUI(); if (panelShown) render(); }, { once: true });
      return;
    }
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    root = el('div', { id: 'bili-dead-panel' });
    root.style.display = 'none';

    root.appendChild(el('div', { class: 'bdp-head' }, [
      el('span', { text: '🚫 失效视频信息查询' }),
      el('span', { id: 'bili-dead-id', style: 'color:#fb7299' }),
      el('span', { class: 'bdp-close', title: '关闭', text: '✕', onclick: hidePanel }),
    ]));

    const input = el('input', { class: 'bdp-input', placeholder: '输入 BV号 / av号 / 视频链接' });
    const doSearch = () => {
      const id = parseId(input.value);
      if (!id) {
        input.value = '';
        input.placeholder = '未识别到 av/BV 号,请检查输入';
        return;
      }
      startQuery(id, { manual: true });
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch();
    });
    root.appendChild(el('div', { class: 'bdp-manual' }, [
      input,
      el('button', { class: 'bdp-btn', text: '查询', onclick: doSearch }),
    ]));

    contentEl = el('div');
    root.appendChild(contentEl);
    document.body.appendChild(root);

    const ball = el('div', { id: 'bili-dead-ball', title: '失效视频查询(双击隐藏)' });
    ball.innerHTML = '失效<br>查询';
    ball.addEventListener('click', () => {
      panelShown = true;
      render();
    });
    ball.addEventListener('dblclick', () => ball.remove());
    document.body.appendChild(ball);
  }

  function hidePanel() {
    panelShown = false;
    if (root) root.style.display = 'none';
  }

  function render() {
    ensureUI();
    if (!root) return; // DOM尚未就绪,界面推迟到DOMContentLoaded后再渲染
    const idSpan = document.getElementById('bili-dead-id');
    if (idSpan) idSpan.textContent = current ? displayId(current.id) : '';
    if (!panelShown) return;
    root.style.display = 'block';
    contentEl.replaceChildren();

    if (!current) {
      contentEl.appendChild(el('div', { class: 'bdp-status', text: '在上方输入框粘贴 BV号 / av号 / 视频链接进行查询。' }));
      return;
    }

    if (current.alive === true) {
      contentEl.appendChild(el('div', { class: 'bdp-status bdp-ok', text: '✅ 该视频当前仍可正常访问(未失效或已恢复公开)' }));
    } else if (current.alive === false) {
      const off = current.sources.official;
      const note = (off && off.note) || '官方接口确认视频不可见';
      contentEl.appendChild(el('div', { class: 'bdp-status bdp-dead', text: '🚫 视频已失效:' + note + (redirectDisarmed ? '(已拦截本页自动跳转)' : '') }));
    } else {
      contentEl.appendChild(el('div', { class: 'bdp-status', text: '⏳ 正在确认视频状态…' }));
    }

    const m = current.merged;
    if (m && Object.keys(m).length) {
      const card = el('div', { class: 'bdp-card' });
      if (m.pic && /^https?:\/\//.test(String(m.pic))) {
        card.appendChild(el('img', {
          class: 'bdp-cover',
          src: String(m.pic).replace(/^http:/, 'https:'),
          referrerpolicy: 'no-referrer',
        }));
      }
      if (m.title) card.appendChild(el('div', { class: 'bdp-title', text: m.title }));
      const metas = [];
      if (m.ownerName) metas.push('UP主:' + m.ownerName);
      const t = fmtTime(m.pubdate);
      if (t) metas.push('发布:' + t);
      if (m.tname) metas.push('分区:' + m.tname);
      if (m.videos > 1) metas.push('共' + m.videos + 'P');
      if (m.duration) metas.push('时长:' + Math.floor(m.duration / 60) + '分' + (m.duration % 60) + '秒');
      if (metas.length) card.appendChild(el('div', { class: 'bdp-meta', text: metas.join(' | ') }));
      const stats = [
        ['播放', m.view], ['弹幕', m.danmaku], ['评论', m.reply], ['点赞', m.like],
        ['投币', m.coin], ['收藏', m.favorite], ['分享', m.share],
      ].filter(([, v]) => typeof v === 'number' && v >= 0);
      if (stats.length) {
        card.appendChild(el('div', { class: 'bdp-stats' },
          stats.map(([k, v]) => el('span', { text: k + ' ' + fmtNum(v) }))));
      }
      if (Array.isArray(m.tags) && m.tags.length) {
        card.appendChild(el('div', { class: 'bdp-tags' },
          m.tags.slice(0, 12).map((tg) => el('span', { class: 'bdp-tag', text: tg }))));
      }
      if (m.desc) card.appendChild(el('div', { class: 'bdp-desc', text: m.desc }));
      if (m.cacheDate) {
        card.appendChild(el('div', { class: 'bdp-cacheinfo', text: '※ 以上为第三方缓存数据(更新于 ' + m.cacheDate + '),非实时数据' }));
      }
      contentEl.appendChild(card);
    } else if (current.finished && current.alive === false) {
      contentEl.appendChild(el('div', { class: 'bdp-status', text: '所有缓存源都没有收录该视频,可尝试下方搜索与存档链接。' }));
    }

    const list = el('div', { class: 'bdp-sources' });
    for (const def of SOURCE_DEFS) {
      const s = current.sources[def.key] || { status: 'pending' };
      const icon = s.status === 'ok' ? '✅' : s.status === 'empty' ? '➖' : s.status === 'fail' ? '❌' : '⏳';
      const text = s.status === 'ok' ? (s.note || '查到数据')
        : s.status === 'empty' ? (s.note || '无数据')
        : s.status === 'fail' ? (s.error || '查询失败')
        : '查询中…';
      const det = el('details', {}, [
        el('summary', { text: icon + ' ' + def.name + ' — ' + text }),
      ]);
      if (s.raw) {
        det.appendChild(el('pre', { class: 'bdp-raw', text: JSON.stringify(s.raw, null, 2).slice(0, 4000) }));
      }
      list.appendChild(det);
    }
    contentEl.appendChild(list);

    const q = displayId(current.id);
    const links = [
      ['B站搜索', 'https://search.bilibili.com/all?keyword=' + encodeURIComponent(q)],
      ['百度', 'https://www.baidu.com/s?wd=' + encodeURIComponent(q)],
      ['必应', 'https://cn.bing.com/search?q=' + encodeURIComponent(q)],
      ['Google', 'https://www.google.com/search?q=' + encodeURIComponent(q)],
      ['BiliPlus页面', 'https://www.biliplus.com/video/' + q],
      ['Wayback全记录', 'https://web.archive.org/web/*/' + pageUrlOf(current.id)],
    ];
    const wb = current.sources.wayback;
    if (wb && wb.link) links.unshift(['Wayback快照', wb.link]);
    contentEl.appendChild(el('div', { class: 'bdp-links' },
      links.map(([t2, u]) => el('a', { class: 'bdp-link', href: u, target: '_blank', rel: 'noreferrer', text: t2 }))));

    contentEl.appendChild(el('div', { class: 'bdp-actions' }, [
      el('button', {
        class: 'bdp-btn',
        text: '复制JSON',
        onclick: () => GM_setClipboard(JSON.stringify({
          id: displayId(current.id),
          alive: current.alive,
          info: current.merged,
          sources: current.sources,
        }, null, 2)),
      }),
      el('button', { class: 'bdp-btn bdp-btn-re', text: '重新查询', onclick: () => startQuery(current.id, { manual: true }) }),
    ]));
  }

  /* ==================== 页面监听与入口 ==================== */

  let lastVideoKey = null;

  function watchPage() {
    const m = location.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10}|av(\d{1,20}))/i);
    if (!m) {
      lastVideoKey = null;
      return;
    }
    const key = m[1];
    if (key === lastVideoKey) return;
    lastVideoKey = key;
    const id = /^av/i.test(key) ? { type: 'aid', val: m[2] } : { type: 'bvid', val: key };
    autoCheck(id);
  }

  const pageWatcherId = setInterval(watchPage, 800);

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('查询失效视频信息', () => {
      panelShown = true;
      render();
    });
  }
})();
