# 求职日历

本地静态网站，数据集中保存在 `data/opportunities.json`。从目录运行：

```sh
cd job-calendar
python3 -m http.server 8000
```

浏览器访问 <http://localhost:8000/>。停止服务按 `Ctrl+C`。需要通过服务器访问，直接双击 HTML 时浏览器可能阻止加载 JSON。

## 维护

在原始资料中核实变化后，更新同一 JSON 中对应稳定 `id` 的记录、来源与 `checkedAt`。日期使用东京当地 ISO 格式：`YYYY-MM-DD` 表示仅知日期，`YYYY-MM-DDTHH:mm` 表示已知具体时间；不要补造午夜或 23:59。`event` 的 `endDate` 是活动结束，并非申请截止；日期范围包含最后一天。未知日期不创建日期节点，写入 `notes` 或 `nextAction`。`completed: true` 代表该截止节点已完成，避免出现在近期待办。保留状态、来源冲突与尚未核对的说明。详情查看数据文件及数据说明。

设计机会分为 `activity`、`internship`、`selection`，已预约的非设计活动使用独立 `personal` 类别。节点类型包括 `open`、`deadline`、`es_deadline`、`portfolio_deadline`、`test_deadline`、`confirmation_deadline`、`event` 和 `other`。修改后检查 JSON 有效性、页面显示和手机视图，并核对真实申请状态；本地修改不会自动同步远程。

## 技术选择

FullCalendar Standard 适合标准月／周历，vis-timeline 适合分组时间轴；两者均有成熟的免费核心，但分别引入依赖及适配。当前版本使用少量原生 JavaScript 实现所需视图，零运行时依赖，便于静态部署与离线维护，也不涉及 FullCalendar Premium。时间轴提供范围选择、前后移动和横向滚动，未实现 vis-timeline 的连续拖拽缩放。若数据量或交互复杂度继续增加，可重新评估引入上述组件。

## GitHub Pages（尚未发布）

项目使用相对路径，可放在独立仓库根目录。已准备 `.github/workflows/pages.yml`，供未来授权后使用：将本目录内容提交到选定仓库，仓库 Settings → Pages 的 Build and deployment 选择 GitHub Actions；明确授权发布后再手动触发 workflow；推送本身不会自动部署。提交、推送和部署是独立步骤。部署前须审阅整个数据文件和公开范围；GitHub Pages 是公开网站，不适合放置不愿公开的求职状态或个人信息。不要提交整个就职目录、凭证、私人邮件原文或带 token 链接。已授权上传到私有仓库；尚未授权公开发布。

## 视觉与信息层级

本地改版参考了 Linear 的横向时间轴、Notion Calendar 的日程色块和 Amie 对截止与安排时间的区分。站内蓝色代表说明会／反馈、橙色代表实习、紫色代表本选考、青绿色代表已约个人安排；日期标记直接显示“已确认”“截止”“待确认”“开放”或“已办”；时间轴的横条表示报名或活动期间。类别颜色与状态文字共同辅助识别。近期行动置顶全部未来已确认安排，其次列出14天内未完成的明确截止，待结果和指引单独显示。月历每格优先显示已确认安排及未完成截止，点击日期可查看全部节点。

参考：[Linear Timeline](https://linear.app/changelog/2024-02-29-milestones-on-the-timeline)、[Notion Calendar](https://www.notion.com/product/calendar)、[Amie Tasks](https://amie.so/documentation/features/tasks)。
