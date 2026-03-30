/**
 * 公众号文章阅读器 — 前端逻辑
 *
 * 功能:
 * - 加载 data.json 并按 category → source 分组
 * - 左侧栏展示公众号列表（可折叠分类）
 * - 点击公众号显示文章列表
 * - localStorage 记录已读时间，未读公众号显示红标
 * - 搜索过滤公众号（左侧栏）
 * - 顶部页签栏：全部文章 / 全部命中 / 按关键词过滤
 * - 右侧搜索栏：搜索文章标题 / 关键词
 */

(function () {
    "use strict";

    // ===== 全局状态 =====
    let allArticles = {};          // 原始数据 { url: articleObj }
    let groupedData = {};          // { category: { source: [articles] } }
    let currentSource = null;      // 当前选中的公众号
    let currentTab = "all";        // 当前激活的页签: "all" | "hit-all" | "cat:xxx" | "kw:xxx" | "ckw:xxx" | "runlog"
    let pintopSources = [];        // 置顶公众号名称列表（从 pintop.json 加载）
    let allCategoryStats = {};     // { category: { type: "kw"|"ckw"|"mixed", count: N, keywords: Set } }
    let allKeywordStats = {};      // 保留兼容: { keyword: { type, count } }
    let runlogData = [];           // 运行日志摘要数据（从 runlog_summary.json 加载）

    // ===== 辅助: 兼容新旧 hit_kws/hit_ckws 格式 =====
    // 新格式: [{category: "抄底", keyword: "机会"}, ...]
    // 旧格式: ["机会", "底部", ...]
    function _kwItemCategory(item) {
        return (typeof item === "object" && item !== null) ? (item.category || "") : "";
    }
    function _kwItemKeyword(item) {
        return (typeof item === "object" && item !== null) ? (item.keyword || "") : String(item);
    }
    function _articleHasHits(article) {
        return (article.hit_kws && article.hit_kws.length > 0) ||
               (article.hit_ckws && article.hit_ckws.length > 0);
    }
    function _articleMatchesCategory(article, category) {
        if (article.hit_kws) {
            for (const item of article.hit_kws) {
                if (_kwItemCategory(item) === category) return true;
            }
        }
        if (article.hit_ckws) {
            for (const item of article.hit_ckws) {
                if (_kwItemCategory(item) === category) return true;
            }
        }
        return false;
    }

    // ===== DOM 引用 =====
    const tabBar = document.getElementById("tabBar");
    const hitAllCount = document.getElementById("hitAllCount");
    const appBody = document.querySelector(".app-body");
    const sidebarList = document.getElementById("sidebarList");
    const content = document.getElementById("content");
    const searchInput = document.getElementById("searchInput");
    const articleSearchInput = document.getElementById("articleSearchInput");
    const btnClearSearch = document.getElementById("btnClearSearch");
    const btnMarkAll = document.getElementById("btnMarkAll");
    const btnRunlog = document.getElementById("btnRunlog");
    const statsEl = document.getElementById("stats");

    // ===== localStorage 工具 =====
    const READ_TIME_PREFIX = "readTime_";

    function getReadTime(source) {
        const val = localStorage.getItem(READ_TIME_PREFIX + source);
        return val ? val : null;
    }

    function setReadTime(source) {
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);
        localStorage.setItem(READ_TIME_PREFIX + source, dateStr);
    }

    function markAllRead() {
        for (const category of Object.values(groupedData)) {
            for (const source of Object.keys(category)) {
                setReadTime(source);
            }
        }
        refreshBadges();
    }

    // ===== 判断公众号是否有未读文章 =====
    function hasUnread(source, articles) {
        const readTime = getReadTime(source);
        if (!readTime) return true;
        return articles.some(a => a.date > readTime);
    }

    // ===== 计算公众号下命中关键词的文章数 =====
    function countHitArticles(articles) {
        return articles.filter(a =>
            (a.hit_kws && a.hit_kws.length > 0) ||
            (a.hit_ckws && a.hit_ckws.length > 0)
        ).length;
    }

    // ===== 提取所有关键词及统计（按分类分组） =====
    function extractKeywords() {
        const catMap = {};  // { category: { type: "kw"|"ckw"|"mixed", count: N, keywords: Set } }

        for (const article of Object.values(allArticles)) {
            // 收集本文章命中的所有分类
            const hitCategories = new Set();

            if (article.hit_kws) {
                for (const item of article.hit_kws) {
                    const cat = _kwItemCategory(item) || "未分类";
                    hitCategories.add(cat);
                    if (!catMap[cat]) catMap[cat] = { type: "kw", count: 0, keywords: new Set() };
                    catMap[cat].keywords.add(_kwItemKeyword(item));
                }
            }
            if (article.hit_ckws) {
                for (const item of article.hit_ckws) {
                    const cat = _kwItemCategory(item) || "未分类";
                    hitCategories.add(cat);
                    if (!catMap[cat]) catMap[cat] = { type: "ckw", count: 0, keywords: new Set() };
                    if (catMap[cat].type === "kw") catMap[cat].type = "mixed";
                    catMap[cat].keywords.add(_kwItemKeyword(item));
                }
            }

            // 每个分类对该文章只计数一次
            for (const cat of hitCategories) {
                catMap[cat].count++;
            }
        }

        allCategoryStats = catMap;
        return catMap;
    }

    // ===== 渲染顶部页签栏（按分类分组） =====
    function renderTabBar() {
        // 计算全部命中数
        let hitAllTotal = 0;
        for (const article of Object.values(allArticles)) {
            if (_articleHasHits(article)) {
                hitAllTotal++;
            }
        }
        hitAllCount.textContent = hitAllTotal;

        // 移除已有的动态关键词页签
        tabBar.querySelectorAll(".tab-dynamic").forEach(el => el.remove());

        // 按命中数降序排列分类
        const sorted = Object.entries(allCategoryStats)
            .sort((a, b) => b[1].count - a[1].count);

        for (const [category, info] of sorted) {
            const btn = document.createElement("button");
            const typeClass = info.type === "ckw" ? "tab-ckw" : (info.type === "mixed" ? "tab-ckw" : "tab-kw");
            btn.className = `tab tab-dynamic ${typeClass}`;
            btn.dataset.tab = `cat:${category}`;
            const kwList = Array.from(info.keywords).join("、");
            btn.title = `关键词: ${kwList}`;
            btn.innerHTML = `${escapeHtml(category)} <span class="tab-count">${info.count}</span>`;
            btn.addEventListener("click", () => switchTab(btn.dataset.tab, btn));
            tabBar.appendChild(btn);
        }
    }

    // ===== 页签切换 =====
    function switchTab(tabId, btnEl) {
        currentTab = tabId;

        // 更新页签激活状态
        tabBar.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
        if (btnEl) {
            btnEl.classList.add("active");
        }

        // 清空文章搜索框
        articleSearchInput.value = "";

        if (tabId === "all") {
            // 全部文章模式：显示左侧栏
            appBody.classList.remove("hit-mode");
            // 如果之前选中了公众号，恢复显示
            if (currentSource) {
                renderArticles(currentSource);
            } else {
                showWelcome();
            }
        } else if (tabId === "runlog") {
            // 运行记录模式：隐藏左侧栏
            appBody.classList.add("hit-mode");
            currentSource = null;
            document.querySelectorAll(".source-item.active").forEach(el => el.classList.remove("active"));
            showRunlog();
        } else {
            // 命中/关键词模式：隐藏左侧栏
            appBody.classList.add("hit-mode");
            currentSource = null;
            document.querySelectorAll(".source-item.active").forEach(el => el.classList.remove("active"));

            if (tabId === "hit-all") {
                showHitArticles(null);
            } else {
                // tabId 格式: "cat:分类名" 或旧格式 "kw:关键词" / "ckw:关键词"
                const colonIdx = tabId.indexOf(":");
                const kwType = tabId.substring(0, colonIdx);
                const keyword = tabId.substring(colonIdx + 1);
                showHitArticles(keyword, kwType);
            }
        }
    }

    // ===== 显示欢迎页 =====
    function showWelcome() {
        const sourceSet = new Set();
        let totalArticles = 0;
        for (const article of Object.values(allArticles)) {
            sourceSet.add(article.source || "未知");
            totalArticles++;
        }
        content.innerHTML = `
            <div class="welcome">
                <h1>📖 公众号文章阅读器</h1>
                <p>点击左侧公众号查看文章列表</p>
                <p class="stats">${sourceSet.size} 个公众号，${totalArticles} 篇文章</p>
            </div>
        `;
    }

    // ===== 数据加载与分组 =====
    async function loadData() {
        try {
            const resp = await fetch("data.json");
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            allArticles = await resp.json();
        } catch (err) {
            sidebarList.innerHTML = `<div class="loading">❌ 加载失败: ${err.message}<br>请先运行 build_data.py 生成 data.json</div>`;
            return;
        }

        // 加载置顶公众号配置
        try {
            const pintopResp = await fetch("pintop.json");
            if (pintopResp.ok) {
                pintopSources = await pintopResp.json();
                if (!Array.isArray(pintopSources)) pintopSources = [];
            }
        } catch (_) {
            pintopSources = [];
        }

        // 按 category → source 分组
        groupedData = {};
        let totalArticles = 0;
        const sourceSet = new Set();

        for (const [url, article] of Object.entries(allArticles)) {
            const cat = article.category || "未分类";
            const src = article.source || "未知";
            if (!groupedData[cat]) groupedData[cat] = {};
            if (!groupedData[cat][src]) groupedData[cat][src] = [];
            groupedData[cat][src].push({ ...article, url });
            totalArticles++;
            sourceSet.add(src);
        }

        // 每个 source 的文章按日期降序排列
        for (const cat of Object.values(groupedData)) {
            for (const src of Object.keys(cat)) {
                cat[src].sort((a, b) => b.date.localeCompare(a.date));
            }
        }

        // 更新统计
        if (statsEl) {
            statsEl.textContent = `共 ${sourceSet.size} 个公众号，${totalArticles} 篇文章`;
        }

        // 提取关键词并渲染页签栏
        extractKeywords();
        renderTabBar();

        renderSidebar();

        // 加载运行日志摘要
        try {
            const runlogResp = await fetch("runlog_summary.json");
            if (runlogResp.ok) {
                runlogData = await runlogResp.json();
                if (!Array.isArray(runlogData)) runlogData = [];
            }
        } catch (_) {
            runlogData = [];
        }
    }

    // ===== 收集某个公众号在所有分类下的文章 =====
    function collectArticles(source) {
        let articles = [];
        for (const cat of Object.values(groupedData)) {
            if (cat[source]) articles = articles.concat(cat[source]);
        }
        return articles;
    }

    // ===== 创建公众号条目 DOM =====
    function createSourceItem(src, articles) {
        const item = document.createElement("div");
        item.className = "source-item";
        item.dataset.source = src;

        const unread = hasUnread(src, articles);
        const hitCount = countHitArticles(articles);

        item.innerHTML = `
            <span class="source-name">
                ${unread ? '<span class="badge"></span>' : ""}
                <span class="name-text">${escapeHtml(src)}</span>
                ${hitCount > 0 ? `<span class="badge-hit">${hitCount}</span>` : ""}
            </span>
            <span class="count">${articles.length}</span>
        `;

        item.addEventListener("click", () => selectSource(src, item));
        return item;
    }

    // ===== 渲染左侧栏 =====
    function renderSidebar() {
        sidebarList.innerHTML = "";

        // ---- 置顶分组 ----
        if (pintopSources.length > 0) {
            const pintopGroup = document.createElement("div");
            pintopGroup.className = "category-group pintop-group";

            const pintopHeader = document.createElement("div");
            pintopHeader.className = "category-header pintop-header";
            pintopHeader.innerHTML = `<span class="arrow">▼</span> ⭐ 常用置顶`;
            pintopHeader.addEventListener("click", () => toggleCategory(pintopHeader));
            pintopGroup.appendChild(pintopHeader);

            const pintopItems = document.createElement("div");
            pintopItems.className = "category-items";

            for (const src of pintopSources) {
                const articles = collectArticles(src);
                if (articles.length === 0) continue;
                pintopItems.appendChild(createSourceItem(src, articles));
            }

            if (pintopItems.children.length > 0) {
                pintopGroup.appendChild(pintopItems);
                sidebarList.appendChild(pintopGroup);
            }
        }

        // ---- 按 category 名称排序的常规分组 ----
        const categories = Object.keys(groupedData).sort();

        for (const cat of categories) {
            const sources = groupedData[cat];
            const group = document.createElement("div");
            group.className = "category-group";
            group.dataset.category = cat;

            const header = document.createElement("div");
            header.className = "category-header";
            header.innerHTML = `<span class="arrow">▼</span> ${escapeHtml(cat)}`;
            header.addEventListener("click", () => toggleCategory(header));
            group.appendChild(header);

            const itemsContainer = document.createElement("div");
            itemsContainer.className = "category-items";

            const sortedSources = Object.keys(sources).sort();
            for (const src of sortedSources) {
                const articles = sources[src];
                itemsContainer.appendChild(createSourceItem(src, articles));
            }

            group.appendChild(itemsContainer);
            sidebarList.appendChild(group);
        }
    }

    // ===== 折叠/展开分类 =====
    function toggleCategory(header) {
        header.classList.toggle("collapsed");
        const items = header.nextElementSibling;
        items.classList.toggle("collapsed");
    }

    // ===== 选中公众号 =====
    function selectSource(source, itemEl) {
        // 切换到全部文章模式
        if (currentTab !== "all") {
            currentTab = "all";
            tabBar.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
            tabBar.querySelector('[data-tab="all"]').classList.add("active");
            appBody.classList.remove("hit-mode");
        }

        currentSource = source;
        document.querySelectorAll(".source-item.active").forEach(el => el.classList.remove("active"));
        itemEl.classList.add("active");

        setReadTime(source);

        const badge = itemEl.querySelector(".badge");
        if (badge) badge.remove();

        // 清空文章搜索框
        articleSearchInput.value = "";

        renderArticles(source);
    }

    // ===== 渲染文章列表（公众号模式） =====
    function renderArticles(source) {
        let articles = collectArticles(source);

        // 去重
        const seen = new Set();
        articles = articles.filter(a => {
            if (seen.has(a.url)) return false;
            seen.add(a.url);
            return true;
        });

        // 按日期降序
        articles.sort((a, b) => b.date.localeCompare(a.date));

        // 应用文章搜索过滤
        const searchKw = articleSearchInput.value.trim().toLowerCase();
        if (searchKw) {
            articles = filterArticlesBySearch(articles, searchKw);
        }

        let html = `
            <div class="article-header">
                <h2>${escapeHtml(source)}</h2>
                <div class="meta">${articles.length} 篇文章 · 分类: ${escapeHtml(articles[0]?.category || "未知")}</div>
            </div>
        `;

        for (const article of articles) {
            html += renderArticleCard(article, false);
        }

        content.innerHTML = html;
        content.scrollTop = 0;
    }

    // ===== 显示命中文章（全部命中 / 按分类或关键词过滤） =====
    function showHitArticles(keyword, kwType) {
        let hitArticles = [];

        for (const [url, article] of Object.entries(allArticles)) {
            let matched = false;

            if (keyword === null) {
                // 全部命中
                matched = _articleHasHits(article);
            } else if (kwType === "cat") {
                // 按分类过滤
                matched = _articleMatchesCategory(article, keyword);
            } else {
                // 旧格式兼容：按关键词过滤 (kw / ckw)
                if (article.hit_kws) {
                    for (const item of article.hit_kws) {
                        if (_kwItemKeyword(item) === keyword) { matched = true; break; }
                    }
                }
                if (!matched && article.hit_ckws) {
                    for (const item of article.hit_ckws) {
                        if (_kwItemKeyword(item) === keyword) { matched = true; break; }
                    }
                }
            }

            if (matched) {
                hitArticles.push({ ...article, url });
            }
        }

        // 按日期降序
        hitArticles.sort((a, b) => b.date.localeCompare(a.date));

        // 应用文章搜索过滤
        const searchKw = articleSearchInput.value.trim().toLowerCase();
        if (searchKw) {
            hitArticles = filterArticlesBySearch(hitArticles, searchKw);
        }

        if (hitArticles.length === 0) {
            const title = keyword
                ? (kwType === "cat" ? `🏷️ 分类: ${escapeHtml(keyword)}` : `🎯 关键词: ${escapeHtml(keyword)}`)
                : "🎯 命中文章";
            content.innerHTML = `
                <div class="welcome">
                    <h1>${title}</h1>
                    <p>暂无匹配的文章</p>
                </div>
            `;
            return;
        }

        const title = keyword
            ? (kwType === "cat" ? `🏷️ 分类: ${escapeHtml(keyword)}` : `🎯 关键词: ${escapeHtml(keyword)}`)
            : "🎯 命中关键词文章";
        const subtitle = keyword
            ? (kwType === "cat"
                ? `${hitArticles.length} 篇文章命中分类「${escapeHtml(keyword)}」`
                : `${hitArticles.length} 篇文章命中「${escapeHtml(keyword)}」`)
            : `${hitArticles.length} 篇文章命中关键词`;

        let html = `
            <div class="article-header">
                <h2>${title}</h2>
                <div class="meta">${subtitle}</div>
            </div>
        `;

        for (const article of hitArticles) {
            html += renderArticleCard(article, true);
        }

        content.innerHTML = html;
        content.scrollTop = 0;
    }

    // ===== 渲染单个文章卡片 =====
    function renderArticleCard(article, showSource) {
        const isHighlighted = article.highlighted || _articleHasHits(article);
        const highlightClass = isHighlighted ? " highlighted" : "";
        const tags = buildTags(article);
        const sourceInfo = showSource ? ` · 📢 ${escapeHtml(article.source || "未知")}` : "";

        return `
            <div class="article-card${highlightClass}">
                <div class="article-title">
                    <a href="${escapeHtml(article.url)}" target="_blank" rel="noopener">${escapeHtml(article.title)}</a>
                </div>
                <div class="article-date">📅 ${escapeHtml(article.date)}${sourceInfo}</div>
                ${tags}
            </div>
        `;
    }

    // ===== 构建关键词标签（兼容新旧格式） =====
    function buildTags(article) {
        const tags = [];
        if (article.hit_kws && article.hit_kws.length > 0) {
            for (const item of article.hit_kws) {
                const kw = _kwItemKeyword(item);
                const cat = _kwItemCategory(item);
                const label = cat ? `${cat}/${kw}` : `标题: ${kw}`;
                tags.push(`<span class="tag kw">${escapeHtml(label)}</span>`);
            }
        }
        if (article.hit_ckws && article.hit_ckws.length > 0) {
            for (const item of article.hit_ckws) {
                const kw = _kwItemKeyword(item);
                const cat = _kwItemCategory(item);
                const label = cat ? `${cat}/${kw}` : `内容: ${kw}`;
                tags.push(`<span class="tag ckw">${escapeHtml(label)}</span>`);
            }
        }
        if (tags.length === 0) return "";
        return `<div class="tags">${tags.join("")}</div>`;
    }

    // ===== 文章搜索过滤（兼容新旧格式） =====
    function filterArticlesBySearch(articles, searchKw) {
        return articles.filter(a => {
            // 搜索标题
            if (a.title && a.title.toLowerCase().includes(searchKw)) return true;
            // 搜索标题关键词
            if (a.hit_kws && a.hit_kws.some(item => _kwItemKeyword(item).toLowerCase().includes(searchKw))) return true;
            // 搜索内容关键词
            if (a.hit_ckws && a.hit_ckws.some(item => _kwItemKeyword(item).toLowerCase().includes(searchKw))) return true;
            // 搜索分类名
            if (a.hit_kws && a.hit_kws.some(item => (_kwItemCategory(item) || "").toLowerCase().includes(searchKw))) return true;
            if (a.hit_ckws && a.hit_ckws.some(item => (_kwItemCategory(item) || "").toLowerCase().includes(searchKw))) return true;
            return false;
        });
    }

    // ===== 格式化耗时 =====
    function formatDuration(seconds) {
        if (seconds < 60) return `${seconds}秒`;
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        if (m < 60) return s > 0 ? `${m}分${s}秒` : `${m}分`;
        const h = Math.floor(m / 60);
        const rm = m % 60;
        return rm > 0 ? `${h}小时${rm}分` : `${h}小时`;
    }

    // ===== 显示运行记录 =====
    function showRunlog() {
        if (!runlogData || runlogData.length === 0) {
            content.innerHTML = `
                <div class="welcome">
                    <h1>📋 上传记录</h1>
                    <p>暂无运行记录</p>
                    <p class="stats">运行 WeChatSpiderCmdV2 后将自动生成记录</p>
                </div>
            `;
            return;
        }

        let html = `
            <div class="article-header">
                <h2>📋 上传记录</h2>
                <div class="meta">共 ${runlogData.length} 轮运行记录</div>
            </div>
        `;

        for (const record of runlogData) {
            const duration = formatDuration(record.duration_seconds || 0);
            const hitCount = record.hit_articles ? record.hit_articles.length : 0;

            html += `<div class="runlog-card">`;
            html += `<div class="runlog-header">`;
            html += `<div class="runlog-time">📋 ${escapeHtml(record.run_time || "未知时间")}  <span class="runlog-duration">⏱ ${duration}</span></div>`;
            html += `<div class="runlog-stats">抓取 ${record.sources_crawled || 0} 个公众号 · 新增 ${record.total_new_articles || 0} 篇 · 命中 ${hitCount} 篇</div>`;
            html += `</div>`;

            if (hitCount > 0) {
                // 按 category 分组
                const catGroups = {};
                for (const article of record.hit_articles) {
                    const categories = new Set();
                    if (article.hit_kws) {
                        for (const item of article.hit_kws) {
                            categories.add(_kwItemCategory(item) || "未分类");
                        }
                    }
                    if (article.hit_ckws) {
                        for (const item of article.hit_ckws) {
                            categories.add(_kwItemCategory(item) || "未分类");
                        }
                    }
                    if (categories.size === 0) categories.add("未分类");
                    for (const cat of categories) {
                        if (!catGroups[cat]) catGroups[cat] = [];
                        catGroups[cat].push(article);
                    }
                }

                // 按文章数降序排列分组
                const sortedCats = Object.entries(catGroups)
                    .sort((a, b) => b[1].length - a[1].length);

                html += `<div class="runlog-hits">`;
                for (const [cat, articles] of sortedCats) {
                    html += `<div class="runlog-cat-group">`;
                    html += `<div class="runlog-cat-header">🏷️ ${escapeHtml(cat)}（${articles.length}篇）</div>`;
                    html += `<ul class="runlog-hit-list">`;
                    for (const a of articles) {
                        const sourceInfo = a.source ? ` — ${escapeHtml(a.source)}` : "";
                        const dateInfo = a.date ? ` ${escapeHtml(a.date)}` : "";
                        html += `<li><a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.title)}</a>${sourceInfo}${dateInfo}</li>`;
                    }
                    html += `</ul>`;
                    html += `</div>`;
                }
                html += `</div>`;
            } else {
                html += `<div class="runlog-no-hits">✅ 本轮无命中文章</div>`;
            }

            html += `</div>`;
        }

        content.innerHTML = html;
        content.scrollTop = 0;
    }

    // ===== 文章搜索输入处理 =====
    function onArticleSearch() {
        if (currentTab === "all") {
            if (currentSource) {
                renderArticles(currentSource);
            }
        } else if (currentTab === "hit-all") {
            showHitArticles(null);
        } else {
            const colonIdx = currentTab.indexOf(":");
            const kwType = currentTab.substring(0, colonIdx);
            const keyword = currentTab.substring(colonIdx + 1);
            showHitArticles(keyword, kwType);
        }
    }

    // ===== 刷新所有红标 =====
    function refreshBadges() {
        document.querySelectorAll(".source-item").forEach(item => {
            const src = item.dataset.source;
            const articles = collectArticles(src);
            const unread = hasUnread(src, articles);
            const existingBadge = item.querySelector(".badge");
            const nameSpan = item.querySelector(".source-name");

            if (unread && !existingBadge) {
                const badge = document.createElement("span");
                badge.className = "badge";
                nameSpan.insertBefore(badge, nameSpan.firstChild);
            } else if (!unread && existingBadge) {
                existingBadge.remove();
            }
        });
    }

    // ===== 搜索过滤公众号（左侧栏） =====
    function filterSources(keyword) {
        const kw = keyword.toLowerCase().trim();
        document.querySelectorAll(".category-group").forEach(group => {
            let hasVisible = false;
            group.querySelectorAll(".source-item").forEach(item => {
                const name = item.dataset.source.toLowerCase();
                if (!kw || name.includes(kw)) {
                    item.classList.remove("hidden");
                    hasVisible = true;
                } else {
                    item.classList.add("hidden");
                }
            });
            if (hasVisible) {
                group.classList.remove("hidden");
            } else {
                group.classList.add("hidden");
            }
        });
    }

    // ===== HTML 转义 =====
    function escapeHtml(str) {
        if (!str) return "";
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    // ===== 事件绑定 =====

    // 左侧栏搜索
    searchInput.addEventListener("input", (e) => filterSources(e.target.value));

    // 全部已读
    btnMarkAll.addEventListener("click", markAllRead);

    // 顶部页签 - 固定页签
    tabBar.querySelector('[data-tab="all"]').addEventListener("click", function () {
        switchTab("all", this);
    });
    tabBar.querySelector('[data-tab="hit-all"]').addEventListener("click", function () {
        switchTab("hit-all", this);
    });

    // 上传记录按钮
    if (btnRunlog) {
        btnRunlog.addEventListener("click", function () {
            switchTab("runlog", this);
        });
    }

    // 右侧文章搜索
    articleSearchInput.addEventListener("input", onArticleSearch);

    // 清除搜索
    btnClearSearch.addEventListener("click", () => {
        articleSearchInput.value = "";
        onArticleSearch();
    });

    // ===== 启动 =====
    loadData();
})();
