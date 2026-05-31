/**
 * NewPages 前端 — 按需加载公众号文章
 *
 * 数据来源：
 *   manifest.json — 公众号清单（名称/分类/数量/命中数）
 *   gzh/{名字}.json — 单个公众号的文章数据
 */
(function () {
  'use strict';

  let manifest = null;        // { updated_at, accounts: [...] }
  let currentName = null;     // 当前选中的公众号
  let articleCache = {};      // { name: {url: article} }
  let filterMode = 'all';    // 'all' | 'hits'

  // DOM
  const $accountList = document.getElementById('account-list');
  const $articleList = document.getElementById('article-list');
  const $welcome = document.getElementById('welcome');
  const $articleHeader = document.getElementById('article-header');
  const $currentSource = document.getElementById('current-source');
  const $articleCount = document.getElementById('article-count');
  const $searchInput = document.getElementById('search-input');
  const $updateTime = document.getElementById('update-time');
  const $totalStats = document.getElementById('total-stats');
  const $welcomeStats = document.getElementById('welcome-stats');

  // ===== 初始化 =====
  async function init() {
    try {
      const resp = await fetch('manifest.json');
      manifest = await resp.json();
    } catch (e) {
      $accountList.innerHTML = '<div class="loading-msg">加载 manifest.json 失败</div>';
      return;
    }

    // 显示更新时间
    if (manifest.updated_at) {
      $updateTime.textContent = '更新: ' + manifest.updated_at.replace('T', ' ').slice(0, 19);
    }

    const totalArticles = manifest.accounts.reduce((s, a) => s + (a.count || 0), 0);
    const totalHits = manifest.accounts.reduce((s, a) => s + (a.hit_count || 0), 0);
    $totalStats.textContent = `${manifest.accounts.length} 个公众号 / ${totalArticles} 篇文章 / ${totalHits} 命中`;
    $welcomeStats.textContent = $totalStats.textContent;

    renderSidebar();
    bindEvents();
  }

  // ===== 渲染左侧栏 =====
  function renderSidebar() {
    const search = ($searchInput.value || '').trim().toLowerCase();
    let accounts = manifest.accounts;

    // 搜索过滤
    if (search) {
      accounts = accounts.filter(a => a.name.toLowerCase().includes(search));
    }
    // 命中过滤
    if (filterMode === 'hits') {
      accounts = accounts.filter(a => a.hit_count > 0);
    }

    // 按分类分组
    const groups = {};
    for (const acc of accounts) {
      const cat = acc.category || '未分类';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(acc);
    }

    // 渲染
    let html = '';
    const cats = Object.keys(groups).sort();
    for (const cat of cats) {
      const items = groups[cat];
      html += `<div class="cat-group">`;
      html += `<div class="cat-header" data-cat="${cat}"><span class="arrow">▼</span> ${cat} (${items.length})</div>`;
      html += `<div class="cat-items">`;
      for (const acc of items) {
        const active = acc.name === currentName ? ' active' : '';
        const hitDot = acc.hit_count > 0 ? '<span class="hit-dot"></span>' : '';
        html += `<div class="account-item${active}" data-name="${acc.name}">
          ${hitDot}
          <span class="name">${acc.name}</span>
          <span class="count">${acc.count}</span>
        </div>`;
      }
      html += '</div></div>';
    }

    $accountList.innerHTML = html || '<div class="loading-msg">无匹配结果</div>';
  }

  // ===== 加载并显示文章 =====
  async function loadArticles(name) {
    currentName = name;
    renderSidebar(); // 更新 active 状态

    $welcome.classList.add('hidden');
    $articleHeader.classList.remove('hidden');
    $currentSource.textContent = name;
    $articleList.innerHTML = '<div class="loading-msg">加载中...</div>';

    // 从缓存或网络加载
    if (!articleCache[name]) {
      try {
        const resp = await fetch('gzh/' + encodeURIComponent(name) + '.json');
        articleCache[name] = await resp.json();
      } catch (e) {
        $articleList.innerHTML = '<div class="loading-msg">加载失败: ' + e.message + '</div>';
        return;
      }
    }

    const data = articleCache[name];
    const articles = Object.values(data).sort((a, b) => (b.pub_time || 0) - (a.pub_time || 0));
    $articleCount.textContent = articles.length + ' 篇';

    if (articles.length === 0) {
      $articleList.innerHTML = '<div class="loading-msg">暂无文章</div>';
      return;
    }

    let html = '';
    for (const art of articles) {
      const date = art.pub_time ? new Date(art.pub_time * 1000).toLocaleDateString('zh-CN') : '';
      const kws = (art.hit_kws || []).map(k => typeof k === 'object' ? k.keyword : k);
      const kwsHtml = kws.length > 0
        ? `<div class="article-kws">${kws.map(k => `<span class="kw-tag">${k}</span>`).join('')}</div>`
        : '';
      const digest = art.digest ? `<div class="article-digest">${art.digest}</div>` : '';

      html += `<div class="article-card">
        <div class="article-title"><a href="${art.link}" target="_blank">${art.title}</a></div>
        <div class="article-meta"><span>${date}</span><span>${art.source || ''}</span></div>
        ${kwsHtml}
        ${digest}
      </div>`;
    }
    $articleList.innerHTML = html;
  }

  // ===== 事件绑定 =====
  function bindEvents() {
    // 点击公众号
    $accountList.addEventListener('click', (e) => {
      const item = e.target.closest('.account-item');
      if (item) {
        loadArticles(item.dataset.name);
        return;
      }
      // 折叠分类
      const header = e.target.closest('.cat-header');
      if (header) {
        header.classList.toggle('collapsed');
        const items = header.nextElementSibling;
        if (items) items.classList.toggle('collapsed');
      }
    });

    // 搜索
    $searchInput.addEventListener('input', () => renderSidebar());

    // 页签切换
    document.querySelectorAll('.stab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.stab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filterMode = btn.dataset.filter;
        renderSidebar();
      });
    });
  }

  // 启动
  init();
})();
