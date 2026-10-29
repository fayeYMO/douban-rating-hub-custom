# 豆瓣评分汇（自定义版）

基于 [豆瓣评分汇 | Douban Rating Hub](https://greasyfork.org/zh-CN/scripts/572796-%E8%B1%86%E7%93%A3%E8%AF%84%E5%88%86%E6%B1%87-douban-rating-hub) 修改的 Tampermonkey 用户脚本。

## 修改内容

- 评分来源默认展开，不需要每次点击“展开更多评分来源”。
- IMDb 排在 Letterboxd 前面。
- 可在 Tampermonkey 菜单中的“评分汇设置”里关闭 Letterboxd 或其他评分来源。
- 兼容 Edge 浏览器中的豆瓣条目地址。
- 设置为页面加载完成后执行。

## 安装方法

1. 在 Edge 浏览器中安装并启用 Tampermonkey。
2. 打开 `edge://extensions/`，进入 Tampermonkey 的详细信息。
3. 开启“允许用户脚本”。
4. 导入 `douban-rating-hub-custom.user.js`。
5. 停用原版“豆瓣评分汇”，避免重复显示。
6. 打开豆瓣电影条目并刷新页面。

## 使用说明

打开任意豆瓣电影条目页，脚本会自动显示 IMDb、Letterboxd 以及其他已启用平台的评分。

如需关闭某个平台：

1. 点击浏览器工具栏中的 Tampermonkey 图标。
2. 选择“评分汇设置”。
3. 取消勾选不需要的评分来源。
4. 保存设置并刷新页面。

## 兼容页面

- `movie.douban.com/subject/*`
- `www.douban.com/subject/*`
- 其他原脚本支持的豆瓣条目页面

## 许可

本修改版沿用原脚本的 MIT 许可证。

原作者：lzblack  
原项目：[Douban Rating Hub](https://greasyfork.org/zh-CN/scripts/572796-%E8%B1%86%E7%93%A3%E8%AF%84%E5%88%86%E6%B1%87-douban-rating-hub)
