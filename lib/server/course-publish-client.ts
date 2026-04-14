import type { OpenMAICCoursePublishManifestV1 } from '@/lib/server/course-publish-manifest';

export type CoursePlatformPublishMode = 'preview' | 'commit';

type CoursePlatformPublishOptions = {
  courseStatus?: 'DRAFT' | 'PILOT' | 'ACTIVE' | 'ARCHIVED';
  courseVisibility?: 'OPEN' | 'RESTRICTED';
  entitlementEnabled?: boolean;
  replaceManagedChapters?: boolean;
  publishedAt?: string | null;
};

type PublishManifestRequest = {
  manifest: OpenMAICCoursePublishManifestV1;
  mode?: CoursePlatformPublishMode;
  options?: CoursePlatformPublishOptions;
};

function requireEnv(name: string) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

export async function publishManifestToCoursePlatform({
  manifest,
  mode = 'preview',
  options,
}: PublishManifestRequest) {
  const baseUrl = requireEnv('COURSE_PLATFORM_BASE_URL').replace(/\/+$/, '');
  const tenantId = requireEnv('COURSE_PLATFORM_TENANT_ID');
  const sharedSecret = requireEnv('COURSE_PLATFORM_SHARED_SECRET');
  const endpoint = `${baseUrl}/api/integrations/openmaic/publish/m2m/${mode}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
      'x-openmaic-publish-key': sharedSecret,
    },
    body: JSON.stringify({
      manifest,
      options,
      tenantId,
    }),
    cache: 'no-store',
  });

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const payload = contentType.includes('application/json')
    ? await response.json()
    : {
        success: false,
        error: await response.text(),
      };

  if (!response.ok) {
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : typeof payload?.message === 'string'
          ? payload.message
          : `Course publish ${mode} failed`;
    throw new Error(message);
  }

  return payload;
}
