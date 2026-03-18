/**
 * 公众号文章阅读器 — 前端逻辑
 *
 * 功能:
 * - 加载 data.json 并按 category → source 分组
 * - 左侧栏展示公众号列表（可折叠分类）
 * - 点击公众号显示文章列表
 * - localStorage 记录已读时间，未读公众号显示红标
 * - 搜索过滤公众号
 */

(function () {
    "use strict";

    // ===== 全局状态 =====
    let allArticles = {};          // 原始数据 { url: articleObj }
    let groupedData = {};          // { category: { source: [articles] } }
    let currentSource = null;      // 当前选中的公众号

    // ===== DOM 引用 =====
    const sidebarList = document.getElementById("sidebarList");
    const content = document.getElementById("content");
    const searchInput = document.getElementById("searchInput");
    const btnMarkAll = document.getElementById("btnMarkAll");
    const statsEl = document.getElementById("stats");

    // ===== localStorage 工具 =====
    const READ_TIME_PREFIX = "readTime_";

    function getReadTime(source) {
        const val = localStorage.getItem(READ_TIME_PREFIX + source);
        return val ? val : null;
    }

    function setReadTime(source) {
        // 存储为 YYYY-MM-DD 格式，与文章日期格式一致，方便比较
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
        // 刷新左侧栏红标
        refreshBadges();
    }

    // ===== 判断公众号是否有未读文章 =====
    function hasUnread(source, articles) {
        const readTime = getReadTime(source);
        if (!readTime) return true; // 从未阅读过
        return articles.some(a => a.date > readTime);
    }

    // ===== 计算公众号下命中关键词的文章数 =====
    function countHitArticles(articles) {
        return articles.filter(a =>
            (a.hit_kws && a.hit_kws.length > 0) ||
            (a.hit_ckws && a.hit_ckws.length > 0)
        ).length;
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

        renderSidebar();
    }

    // ===== 渲染左侧栏 =====
    function renderSidebar() {
        sidebarList.innerHTML = "";

        // 按 category 名称排序
        const categories = Object.keys(groupedData).sort();

        for (const cat of categories) {
            const sources = groupedData[cat];
            const group = document.createElement("div");
            group.className = "category-group";
            group.dataset.category = cat;

            // 分类头
            const header = document.createElement("div");
            header.className = "category-header";
            header.innerHTML = `<span class="arrow">▼</span> ${escapeHtml(cat)}`;
            header.addEventListener("click", () => toggleCategory(header));
            group.appendChild(header);

            // 公众号列表容器
            const itemsContainer = document.createElement("div");
            itemsContainer.className = "category-items";

            // 按公众号名称排序
            const sortedSources = Object.keys(sources).sort();
            for (const src of sortedSources) {
                const articles = sources[src];
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
                itemsContainer.appendChild(item);
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
        // 更新选中状态
        currentSource = source;
        document.querySelectorAll(".source-item.active").forEach(el => el.classList.remove("active"));
        itemEl.classList.add("active");

        // 记录已读时间
        setReadTime(source);

        // 移除红标
        const badge = itemEl.querySelector(".badge");
        if (badge) badge.remove();

        // 渲染文章列表
        renderArticles(source);
    }

    // ===== 渲染文章列表 =====
    function renderArticles(source) {
        // 收集该公众号在所有分类下的文章
        let articles = [];
        for (const cat of Object.values(groupedData)) {
            if (cat[source]) {
                articles = articles.concat(cat[source]);
            }
        }

        // 去重（同一 URL 可能出现在多个分类中，虽然不太可能）
        const seen = new Set();
        articles = articles.filter(a => {
            if (seen.has(a.url)) return false;
            seen.add(a.url);
            return true;
        });

        // 按日期降序
        articles.sort((a, b) => b.date.localeCompare(a.date));

        let html = `
            <div class="article-header">
                <h2>${escapeHtml(source)}</h2>
                <div class="meta">${articles.length} 篇文章 · 分类: ${escapeHtml(articles[0]?.category || "未知")}</div>
            </div>
        `;

        for (const article of articles) {
            const isHighlighted = article.highlighted ? " highlighted" : "";
            const tags = buildTags(article);

            html += `
                <div class="article-card${isHighlighted}">
                    <div class="article-title">
                        <a href="${escapeHtml(article.url)}" target="_blank" rel="noopener">${escapeHtml(article.title)}</a>
                    </div>
                    <div class="article-date">📅 ${escapeHtml(article.date)}</div>
                    ${tags}
                </div>
            `;
        }

        content.innerHTML = html;
        content.scrollTop = 0;
    }

    // ===== 构建关键词标签 =====
    function buildTags(article) {
        const tags = [];
        if (article.hit_kws && article.hit_kws.length > 0) {
            for (const kw of article.hit_kws) {
                tags.push(`<span class="tag kw">标题: ${escapeHtml(kw)}</span>`);
            }
        }
        if (article.hit_ckws && article.hit_ckws.length > 0) {
            for (const ckw of article.hit_ckws) {
                tags.push(`<span class="tag ckw">内容: ${escapeHtml(ckw)}</span>`);
            }
        }
        if (tags.length === 0) return "";
        return `<div class="tags">${tags.join("")}</div>`;
    }

    // ===== 刷新所有红标 =====
    function refreshBadges() {
        document.querySelectorAll(".source-item").forEach(item => {
            const src = item.dataset.source;
            // 找到该公众号的文章
            let articles = [];
            for (const cat of Object.values(groupedData)) {
                if (cat[src]) articles = articles.concat(cat[src]);
            }
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

    // ===== 搜索过滤 =====
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
            // 如果分类下没有可见的公众号，隐藏整个分类
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
    searchInput.addEventListener("input", (e) => filterSources(e.target.value));
    btnMarkAll.addEventListener("click", markAllRead);

    // ===== 启动 =====
    loadData();
})();
