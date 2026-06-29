# BilibiliDynamicFeedGroupFilter
一个油猴脚本，支持按关注分组（标签）筛选 B 站动态流，让你在动态页只看特定分组的创作者更新。基于<a>https://github.com/chengdidididi/bilibili-timeline-filter-tab<a>进行修改

## 功能支持
- **通过关注分组过滤动态** 可以依照你已经分类好的关注，筛选并渲染动态页面
- **在分组的基础上兼容b站原本的视频、动态、文档分类** 因为使用的是劫持动态流的实现方法，因此可以直接兼容
- 
## 功能演示
<img width="1115" height="253" alt="image" src="https://github.com/user-attachments/assets/44d5000d-72b6-4cfd-a26c-5cc93255e5e0" />

## 使用
### 第一步：安装脚本管理器
本脚本需要配合浏览器扩展 **Tampermonkey (油猴)** 使用。如果你尚未安装，请根据你的浏览器点击下方链接安装：

- [Chrome / Edge 版本](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- [Firefox 版本](https://addons.mozilla.org/zh-CN/firefox/addon/tampermonkey/)
- [Safari 版本 (Userscripts)](https://apps.apple.com/app/userscripts/id1463298887)

### 第二步：安装脚本
确保第一步完成后，复制脚本代码添加到油猴中即可

---

### 使用说明
1. 脚本安装完成后，打开 [Bilibili 动态首页](https://t.bilibili.com/)。
2. 等待页面加载，你会发现在原本的标签栏上方出现了一个**新的横向分组栏**。
3. 点击任意分组（如“特别关注”），列表将自动刷新并只显示该分组下的动态。
4. 再次点击“全部动态”可恢复默认状态。
