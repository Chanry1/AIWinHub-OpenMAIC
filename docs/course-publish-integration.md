# OpenMAIC -> course 发布集成

这条集成的目标不是让 OpenMAIC 直接承担学员看课门户，而是让 OpenMAIC 作为上游产课系统，把课程内容发布到 `course.aiwinhub.com` 对应的课程交付平台。

当前已落地的能力：

- OpenMAIC 可导出 `openmaic-course-publish-v1` manifest
- OpenMAIC 可通过服务端桥接把 manifest 推送到 `course` 平台
- `course` 平台支持 `preview / commit / history`

## 1. 环境变量

在 OpenMAIC 的 `.env.local` 中增加：

```env
COURSE_PLATFORM_BASE_URL=https://course.aiwinhub.com
COURSE_PLATFORM_TENANT_ID=tenant_default
COURSE_PLATFORM_SHARED_SECRET=replace-with-a-long-random-secret
```

说明：

- `COURSE_PLATFORM_BASE_URL`
  指向课程平台 API 所在域名，不要带尾部 `/`
- `COURSE_PLATFORM_TENANT_ID`
  指向课程平台里的目标租户
- `COURSE_PLATFORM_SHARED_SECRET`
  必须与课程平台 API 侧的 `OPENMAIC_PUBLISH_SHARED_SECRET` 完全一致

## 2. OpenMAIC 可用接口

### 导出发布清单

```http
GET /api/classroom/publish-manifest?id=<classroomId>
```

返回：

- `classroomId`
- `manifest`

### 直接发布到课程平台

```http
POST /api/classroom/publish-course
Content-Type: application/json

{
  "id": "<classroomId>",
  "mode": "preview",
  "options": {
    "courseStatus": "DRAFT",
    "courseVisibility": "RESTRICTED",
    "entitlementEnabled": true,
    "replaceManagedChapters": true
  }
}
```

说明：

- `mode=preview` 只预演，不落库
- `mode=commit` 会正式写入课程平台

### 上游独立冒烟脚本

如果 OpenMAIC 运行环境已经配置好了 `COURSE_PLATFORM_*`，可以直接在项目目录执行：

```bash
node scripts/course-publish-smoke.mjs preview
node scripts/course-publish-smoke.mjs commit
```

预期：

- `preview` 返回 `HTTP 200`
- `commit` 返回 `HTTP 201`

## 3. manifest 结构约定

当前版本：

```text
schemaVersion = openmaic-course-publish-v1
sourceSystem  = openmaic
```

当前默认映射：

- `slide -> article`
- `quiz -> article`
- `pbl -> article`
- `interactive -> defer`

也就是说，交互场景目前仍然会被标记成 `defer`，需要后续按正式交付格式补充。

## 4. 课程平台接口

课程平台对 OpenMAIC 暴露的发布入口：

```text
POST /api/integrations/openmaic/publish/m2m/preview
POST /api/integrations/openmaic/publish/m2m/commit
GET  /api/integrations/openmaic/publish/history/:courseId
```

请求头要求：

```http
x-tenant-id: tenant_default
x-openmaic-publish-key: <shared-secret>
```

返回约定：

- `preview` -> `HTTP 200`
- `commit` -> `HTTP 201`

## 5. 最小验收流程

1. 先在课程平台 API 侧配置 `OPENMAIC_PUBLISH_SHARED_SECRET`
2. 再在 OpenMAIC 配置 `COURSE_PLATFORM_*`
3. 用现有 classroom 执行 `publish-manifest`
4. 先做 `publish-course` 的 `preview`
5. 验证 `resolvedCourseSlug / publishableChapters / deferredChapters`
6. 确认无误后再执行 `commit`
7. 最后在课程平台后台查看课程、章节、发布历史

## 6. 当前边界

- 这条链路当前优先保障图文课发布
- 音频 / 视频章节只有在 manifest 中带可发布媒体地址时才会入库
- `interactive` 场景尚未自动转正式交付格式
- 如果 OpenMAIC 运行在 iCloud 路径，Next 全量构建仍可能异常拖慢；生产构建建议在非 iCloud 路径执行
