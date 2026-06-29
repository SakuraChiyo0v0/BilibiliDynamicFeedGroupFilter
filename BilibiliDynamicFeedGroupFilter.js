// ==UserScript==
// @name         B站动态分组过滤
// @namespace    https://github.com/chengdidididi
// @version      1.0
// @description  可以在渲染动态时筛选关注列表分组
// @author       chnaxoeng
// @match        https://t.bilibili.com/*
// @grant        unsafeWindow
// @license      MIT
// @icon         https://www.bilibili.com/favicon.ico
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';
    // --- 脚本配置 ---

    const GLOBAL_STATE = {
        isFiltering: false, // 是否开启过滤模式
        targetUids: [], // 当前选中的目标UID列表
        myUid: null,// 当前登录用户的UID
        consecutiveEmptyResponses:0//熔断计数器，当连续访问分页未命中次数过多时熔断
    };

    const API_CONFIG = {
        TAGS: 'https://api.bilibili.com/x/relation/tags', // 获取分组列表
        TAG_USERS: 'https://api.bilibili.com/x/relation/tag',// 获取分组下的成员
        FEED_API: 'polymer/web-dynamic/v1/feed/all'// 动态流API片段
    };

    const UI_CONFIG = {
        MAX_RETRY_PAGES: 10, // 过滤模式下，如果没有匹配内容，最大自动翻页数
        MAX_EMPTY_BATCHES: 3//最大连续空包数
    };

    // --- Fetch API劫持实现动态过滤 ---
    const originalFetch = unsafeWindow.fetch;
    //备份原fetch方法后劫持并重写
    unsafeWindow.fetch = async function(urlOrRequest, options) {//URL标准化，字符串则直接使用，request对象则取出url
        let urlString;
        if (typeof urlOrRequest === 'string') {
            urlString = urlOrRequest;
        } else if (urlOrRequest instanceof Request) {
            urlString = urlOrRequest.url;
        } else {
            urlString = String(urlOrRequest);
        }

        // 仅在开启过滤且请求为动态流时拦截
        if (GLOBAL_STATE.isFiltering && urlString.includes(API_CONFIG.FEED_API)) {
            return await fetchUntilFound(urlString, options, 1);
        }

        return originalFetch(urlOrRequest, options);//当过滤未开启或不是动态流api时，调用原fetch方法
    };

    function constructNextUrl(currentUrlString, nextOffset) {//通过URL方法以base地址和当前url构建新的url，并替换offset达到读取下一页的效果
        try {
            const urlObj = new URL(currentUrlString, location.href);
            urlObj.searchParams.set('offset', nextOffset);
            return urlObj.toString();
        } catch (e) {
            return currentUrlString;
        }
    }

    async function fetchUntilFound(url, options, attempt) {
        try {
            const response = await originalFetch(url, options);
            if (!response.ok) return response;

            const clone = response.clone();//发起真实请求并clone非报错的response
            let data;
            try {
                data = await clone.json();//response中json解析错误
            } catch (jsonErr) {
                return response;
            }

            if (!data?.data?.items || !Array.isArray(data.data.items)) {//response中json不含有data.data.item或data.data.item不是数组
                return response;
            }

            // 通过filter(item->({}))方法过滤data.data.items中的动态，定义当前循环对象为item
            const filteredItems = data.data.items.filter(item => {
                const mid = item?.modules?.module_author?.mid;
                return GLOBAL_STATE.targetUids.includes(mid);//当targetUids包含遍历到的对象中的item.modules.module_author.mid，则该动态被滤出
            });

            const nextOffset = data.data.offset;
            const hasMore = data.data.has_more;

            if (filteredItems.length > 0) {// 当过滤后至少有一条，则说明命中了数据
                GLOBAL_STATE.consecutiveEmptyResponses = 0;//清空熔断计数器
                data.data.items = filteredItems;//重新把过滤后的数组包装成json作response传给前端渲染
                return new Response(JSON.stringify(data), {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                });
            }

            // 未命中且动态流显示还能往下、且未达到最大未命中阈值时，继续翻页
            if (hasMore && nextOffset && attempt <= UI_CONFIG.MAX_RETRY_PAGES) {
                const nextUrl = constructNextUrl(url, nextOffset);
                return await fetchUntilFound(nextUrl, options, attempt + 1);
            }

            // 达到尝试上限，返回空数据并同步 offset
            GLOBAL_STATE.consecutiveEmptyResponses++;
            data.data.items = [];
            if (nextOffset) {
                data.data.offset = nextOffset;
            }
            if (GLOBAL_STATE.consecutiveEmptyResponses >= UI_CONFIG.MAX_EMPTY_BATCHES){
                data.data.has_more = false;//达到尝试上限的次数达到阈值，触发熔断，将has_more置为false避免再进行刷新
            }

            return new Response(JSON.stringify(data), {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers
            });

        } catch (e) {
            console.error('Fetch filter error:', e);
            return originalFetch(url, options);
        }
    }

    // --- 动态分组tab实现 ---
    //通过cookie读取你的b站uid
    function getMyUid() {
        const match = document.cookie.match(/DedeUserID=([^;]+)/);
        return match ? match[1] : null;
    }
    //定义一个携带你cookie的fetch方法
    async function fetchJson(url) {
        const res = await fetch(url, { credentials: 'include' });
        return await res.json();
    }

    async function fetchUidsByTag(tagId) {
        if (!GLOBAL_STATE.myUid) GLOBAL_STATE.myUid = getMyUid();//确保拿到了当前用户的 ID

        let page = 1;
        let pageSize = 20;
        let allUids = [];
        let hasMore = true;

        while (hasMore) {
            const url = `${API_CONFIG.TAG_USERS}?mid=${GLOBAL_STATE.myUid}&tagid=${tagId}&pn=${page}&ps=${pageSize}`;
            try {
                const json = await fetchJson(url);
                if (json.code !== 0) break;//API 返回错误码，强制停止

                const data = json.data;
                if (!data || !data.length) {// 如果 data 是空的，或者长度为 0，说明没数据了，停止
                    hasMore = false;
                    break;
                }

                const uids = data.map(user => user.mid);// 使用map()把 mid (UID) 提取出来变成新数组
                allUids.push(...uids);//将得到的结果push到allUids

                if (data.length < pageSize) {
                    hasMore = false;
                } else {
                    page++;
                    await new Promise(r => setTimeout(r, 100));// 等待0.1秒，防止请求太快触发 B 站的 412/429 频率限制。
                }
            } catch (e) {
                hasMore = false;
            }
        }
        return allUids;
    }

    // --- UI渲染与交互 ---

    async function forceFeedReload() {// 通过点按视频再点按全部达到强制刷新
        // 获取原生标签栏
        const nativeTabs = document.querySelectorAll('.bili-dyn-list-tabs__item');
        if (nativeTabs.length < 2) {
            console.warn('无法找到原生标签，尝试滚动刷新');
            window.scrollTo({ top: 0, behavior: 'auto' });
            return;
        }

        const allTab = nativeTabs[0]; // "全部"
        const videoTab = nativeTabs[1]; // "视频"
        GLOBAL_STATE.consecutiveEmptyResponses = 0;// 切换标签时，重置熔断计数器
        videoTab.click();
        await new Promise(r => setTimeout(r, 100));
        allTab.click();
        window.scrollTo({ top: 0, behavior: 'smooth' });//滚动回顶部
    }

    const STYLE_CSS = `
        .custom-group-tabs-wrapper {
            position: relative;
            background: #ffffff;
            border-radius: 6px;
            margin-bottom: 8px;
            height: 48px;
            font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
            box-sizing: border-box;
            border: 1px solid #f1f2f3;
            display: flex;
            align-items: center;
            overflow: hidden;
        }
        .custom-group-tabs-scroll {
            flex: 1;
            overflow: hidden;
            height: 100%;
            position: relative;
            min-width: 0;
        }
        .custom-group-tabs-content {
            display: flex;
            flex-wrap: nowrap;
            align-items: center;
            height: 100%;
            padding: 0 10px;
            transition: transform 0.25s ease;
            will-change: transform;
        }
        .custom-group-tab-item {
            position: relative;
            margin-right: 24px;
            font-size: 14px;
            color: #61666d;
            cursor: pointer;
            height: 100%;
            display: flex;
            align-items: center;
            white-space: nowrap;
            flex-shrink: 0;
            transition: color 0.2s;
            user-select: none;
        }
        .custom-group-tab-item:last-child {
            margin-right: 0;
        }
        .custom-group-tab-item:hover {
            color: #00aeec;
        }
        .custom-group-tab-item.active {
            color: #00aeec;
            font-weight: 600;
        }
        .custom-group-tab-item.loading {
            color: #fb7299;
            cursor: wait;
        }
        .custom-group-nav-btn {
            flex-shrink: 0;
            width: 32px;
            height: 100%;
            display: none;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            color: #61666d;
            background: #ffffff;
            z-index: 2;
            transition: opacity 0.2s, background 0.2s;
        }
        .custom-group-nav-btn.visible {
            display: flex;
        }
        .custom-group-nav-btn:hover {
            color: #00aeec;
            background: #f6f7f8;
        }
        .custom-group-nav-btn.disabled {
            opacity: 0.3;
            cursor: default;
            pointer-events: none;
        }
        .custom-group-nav-btn.prev {
            border-right: 1px solid #f1f2f3;
        }
        .custom-group-nav-btn.next {
            border-left: 1px solid #f1f2f3;
        }
        .custom-group-nav-btn svg {
            width: 12px;
            height: 12px;
        }
    `;

    function renderTabs(parentElement, nextSiblingElement, tags) {
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-group-tabs-wrapper';

        // 左箭头
        const prevBtn = document.createElement('div');
        prevBtn.className = 'custom-group-nav-btn prev';
        prevBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" width="12" height="12"><path d="M7.72855 1.521445C7.9238 1.71671 7.9238 2.03329 7.72855 2.228555L4.04549 5.9116C3.996675 5.96045 3.996675 6.03955 4.04549 6.0884L7.72855 9.77145C7.9238 9.9667 7.9238 10.2833 7.72855 10.47855C7.5333 10.6738 7.2167 10.6738 7.02145 10.47855L3.338385 6.7955C2.899045 6.35615 2.899045 5.64385 3.338385 5.2045L7.02145 1.521445C7.2167 1.326185 7.5333 1.326185 7.72855 1.521445z" fill="currentColor"></path></svg>`;

        // 滚动区域
        const scrollContainer = document.createElement('div');
        scrollContainer.className = 'custom-group-tabs-scroll';

        const scrollContent = document.createElement('div');
        scrollContent.className = 'custom-group-tabs-content';

        // 右箭头
        const nextBtn = document.createElement('div');
        nextBtn.className = 'custom-group-nav-btn next';
        nextBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" width="12" height="12"><path d="M4.27145 1.521445C4.076185 1.71671 4.076185 2.03329 4.27145 2.228555L7.9545 5.9116C8.0033 5.96045 8.0033 6.03955 7.9545 6.0884L4.27145 9.77145C4.076185 9.9667 4.076185 10.2833 4.27145 10.47855C4.46671 10.6738 4.783295 10.6738 4.978555 10.47855L8.6616 6.7955C9.10095 6.35615 9.10095 5.64385 8.6616 5.2045L4.978555 1.521445C4.783295 1.326185 4.46671 1.326185 4.27145 1.521445z" fill="currentColor"></path></svg>`;

        // 当前滚动偏移量
        let currentOffset = 0;
        const scrollStep = 200; // 每次点击滚动的像素距离

        // 检查是否需要显示按钮并更新状态
        function updateNavButtons() {
            // 使用 requestAnimationFrame 确保 DOM 布局已更新
            requestAnimationFrame(() => {
                const containerWidth = scrollContainer.clientWidth;
                const contentWidth = scrollContent.scrollWidth;
                const needsScroll = contentWidth > containerWidth;

                if (needsScroll) {
                    prevBtn.classList.add('visible');
                    nextBtn.classList.add('visible');
                } else {
                    prevBtn.classList.remove('visible');
                    nextBtn.classList.remove('visible');
                    // 内容不超出时重置偏移
                    currentOffset = 0;
                    scrollContent.style.transform = 'translateX(0px)';
                    return;
                }

                // 更新左右箭头禁用状态
                if (currentOffset <= 0) {
                    prevBtn.classList.add('disabled');
                } else {
                    prevBtn.classList.remove('disabled');
                }

                const maxOffset = contentWidth - containerWidth;
                if (currentOffset >= maxOffset - 1) { // -1 处理浮点数精度
                    nextBtn.classList.add('disabled');
                } else {
                    nextBtn.classList.remove('disabled');
                }
            });
        }

        // 滚动逻辑
        function scrollTo(offset) {
            const maxOffset = Math.max(0, scrollContent.scrollWidth - scrollContainer.clientWidth);
            currentOffset = Math.max(0, Math.min(offset, maxOffset));
            scrollContent.style.transform = `translateX(-${currentOffset}px)`;
            updateNavButtons();
        }

        prevBtn.addEventListener('click', () => {
            scrollTo(currentOffset - scrollStep);
        });

        nextBtn.addEventListener('click', () => {
            scrollTo(currentOffset + scrollStep);
        });

        // 鼠标滚轮支持（仅当内容超出时）
        scrollContainer.addEventListener('wheel', (e) => {
            const containerWidth = scrollContainer.clientWidth;
            const contentWidth = scrollContent.scrollWidth;
            if (contentWidth > containerWidth && e.deltaY !== 0) {
                e.preventDefault();
                scrollTo(currentOffset + e.deltaY);
            }
        }, { passive: false });

        // 生成标签
        const defaultTab = { name: '全部动态', id: -1 };
        const allTabs = [defaultTab, ...tags.map(t => ({ name: t.name, id: t.tagid }))];

        allTabs.forEach((tab) => {
            const item = document.createElement('div');
            item.className = 'custom-group-tab-item';
            if (tab.id === -1) item.classList.add('active');
            item.innerText = tab.name;

            item.onclick = async function() {
                const siblings = scrollContent.querySelectorAll('.custom-group-tab-item');
                siblings.forEach(el => el.classList.remove('active'));
                item.classList.add('active');

                if (tab.id === -1) {
                    GLOBAL_STATE.isFiltering = false;
                    GLOBAL_STATE.targetUids = [];
                    forceFeedReload();
                } else {
                    const originalText = item.innerText;
                    item.innerText = '加载中...';
                    item.classList.add('loading');

                    try {
                        const uids = await fetchUidsByTag(tab.id);
                        GLOBAL_STATE.targetUids = uids;
                        GLOBAL_STATE.isFiltering = true;
                        await forceFeedReload();
                    } catch (err) {
                        console.error('Group fetch failed', err);
                        item.innerText = '获取失败';
                    } finally {
                        item.classList.remove('loading');
                        item.innerText = originalText;
                    }
                }
            };

            scrollContent.appendChild(item);
        });

        scrollContainer.appendChild(scrollContent);
        wrapper.appendChild(prevBtn);
        wrapper.appendChild(scrollContainer);
        wrapper.appendChild(nextBtn);
        parentElement.insertBefore(wrapper, nextSiblingElement);

        // 初始化按钮状态
        updateNavButtons();

        // 监听窗口大小变化
        window.addEventListener('resize', updateNavButtons);

        // 使用 MutationObserver 监听内容变化（比如标签加载状态切换后重新检测）
        const observer = new MutationObserver(() => {
            updateNavButtons();
        });
        observer.observe(scrollContent, {
            childList: true,
            subtree: true,
            characterData: true
        });

        // 延迟再检测一次，确保所有样式已应用
        setTimeout(updateNavButtons, 150);
    }

    async function initUI() {
        GLOBAL_STATE.myUid = getMyUid();
        if (!GLOBAL_STATE.myUid) return;// 没登录就直接退出

        const styleEl = document.createElement('style');
        styleEl.innerHTML = STYLE_CSS;
        document.head.appendChild(styleEl);// 把 CSS 样式表插到网页头部

        let tagsData = [];
        try {
            const res = await fetchJson(API_CONFIG.TAGS);// 异步请求分组数据
            if (res.code === 0) tagsData = res.data;
        } catch(e) { console.error(e); }

        const waitForTarget = setInterval(() => {
            const targetElement = document.querySelector('.bili-dyn-list-tabs');//寻找B站原本的标签栏 (.bili-dyn-list-tabs)
            if (targetElement && !document.querySelector('.custom-group-tabs-wrapper')) {
                clearInterval(waitForTarget);
                renderTabs(targetElement.parentNode, targetElement, tagsData);

                // --- 监听"全部动态"是否激活，控制分组标签栏的显示/隐藏 ---
                const upListContent = document.querySelector('.bili-dyn-up-list__content');
                const customWrapper = document.querySelector('.custom-group-tabs-wrapper');

                if (upListContent && customWrapper) {
                    // 检查当前是否选中了"全部动态"
                    function checkActiveState() {
                        const firstItem = upListContent.querySelector('.bili-dyn-up-list__item');
                        if (firstItem) {
                            const isAllActive = firstItem.classList.contains('active');
                            customWrapper.style.display = isAllActive ? 'flex' : 'none';
                            // 如果切换到单个用户，关闭过滤
                            if (!isAllActive && GLOBAL_STATE.isFiltering) {
                                GLOBAL_STATE.isFiltering = false;
                                GLOBAL_STATE.targetUids = [];
                            }
                        }
                    }

                    // 初始检查
                    checkActiveState();

                    // 使用 MutationObserver 监听 active 类的变化
                    const classObserver = new MutationObserver((mutations) => {
                        for (const mutation of mutations) {
                            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                                checkActiveState();
                                break;
                            }
                        }
                    });

                    // 监听所有 item 的 class 变化
                    function bindClassObserver() {
                        upListContent.querySelectorAll('.bili-dyn-up-list__item').forEach(item => {
                            classObserver.observe(item, { attributes: true, attributeFilter: ['class'] });
                        });
                    }
                    bindClassObserver();

                    // 监听 upListContent 的子节点变化（动态加载更多用户时）
                    const listObserver = new MutationObserver(() => {
                        bindClassObserver();
                        checkActiveState();
                    });
                    listObserver.observe(upListContent, { childList: true });
                }
            }
        }, 500);
    }

    if (document.readyState === 'loading') {//网页loading好了再注入
        document.addEventListener('DOMContentLoaded', initUI);
    } else {
        initUI();
    }

})();
