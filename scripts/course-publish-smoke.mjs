#!/usr/bin/env node

const baseUrl = String(process.env.COURSE_PLATFORM_BASE_URL || '').trim().replace(/\/+$/, '');
const tenantId = String(process.env.COURSE_PLATFORM_TENANT_ID || '').trim();
const sharedSecret = String(process.env.COURSE_PLATFORM_SHARED_SECRET || '').trim();
const mode = (process.argv[2] || 'preview').trim().toLowerCase();

if (!baseUrl) {
  console.error('Missing COURSE_PLATFORM_BASE_URL');
  process.exit(1);
}

if (!tenantId) {
  console.error('Missing COURSE_PLATFORM_TENANT_ID');
  process.exit(1);
}

if (!sharedSecret) {
  console.error('Missing COURSE_PLATFORM_SHARED_SECRET');
  process.exit(1);
}

if (!['preview', 'commit'].includes(mode)) {
  console.error('Usage: node scripts/course-publish-smoke.mjs [preview|commit]');
  process.exit(1);
}

const now = new Date();
const ts = now.toISOString();
const suffix = String(Date.now());

const payload = {
  tenantId,
  manifest: {
    schemaVersion: 'openmaic-course-publish-v1',
    sourceSystem: 'openmaic',
    sourceEntityId: `openmaic:smoke:${suffix}`,
    sourceVersion: `smoke-${suffix}`,
    generatedAt: ts,
    language: 'zh-CN',
    title: 'OpenMAIC 上游发布冒烟',
    summary: '用于验证 OpenMAIC -> course 平台发布链路。',
    deliveryFormats: ['article'],
    warnings: [],
    chapters: [
      {
        sourceSceneId: 'scene-smoke-001',
        sourceSceneType: 'slide',
        title: '发布冒烟第一章',
        orderIndex: 1,
        publishMode: 'article',
        articleBlocks: [
          { type: 'heading', text: '发布冒烟第一章', level: 2 },
          { type: 'paragraph', text: '用于验证 OpenMAIC 发布到 course 平台。' },
        ],
      },
    ],
  },
  options: {
    courseStatus: 'DRAFT',
    courseVisibility: 'RESTRICTED',
    entitlementEnabled: true,
    replaceManagedChapters: true,
  },
};

const response = await fetch(`${baseUrl}/api/integrations/openmaic/publish/m2m/${mode}`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-tenant-id': tenantId,
    'x-openmaic-publish-key': sharedSecret,
  },
  body: JSON.stringify(payload),
});

const text = await response.text();
console.log(`HTTP ${response.status}`);
console.log(text);

if (mode === 'preview' && response.status !== 200) {
  process.exit(1);
}

if (mode === 'commit' && response.status !== 201) {
  process.exit(1);
}
