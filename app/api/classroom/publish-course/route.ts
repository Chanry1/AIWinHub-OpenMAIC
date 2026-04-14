import { type NextRequest } from 'next/server';
import { apiError, apiSuccess, API_ERROR_CODES } from '@/lib/server/api-response';
import { publishManifestToCoursePlatform } from '@/lib/server/course-publish-client';
import { buildCoursePublishManifest } from '@/lib/server/course-publish-manifest';
import { isValidClassroomId, readClassroom } from '@/lib/server/classroom-storage';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const id = String(body?.id || '').trim();
    const mode = body?.mode === 'commit' ? 'commit' : 'preview';

    if (!id) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required field: id',
      );
    }
    if (!isValidClassroomId(id)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom id');
    }

    const classroom = await readClassroom(id);
    if (!classroom) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }

    const manifest = buildCoursePublishManifest(classroom);
    const upstream = await publishManifestToCoursePlatform({
      manifest,
      mode,
      options: body?.options,
    });

    return apiSuccess({
      classroomId: classroom.id,
      mode,
      upstream,
    });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.UPSTREAM_ERROR,
      502,
      'Failed to publish classroom to course platform',
      error instanceof Error ? error.message : String(error),
    );
  }
}
