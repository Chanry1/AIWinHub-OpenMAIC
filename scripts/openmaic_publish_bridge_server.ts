import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildCoursePublishManifest } from '../lib/server/course-publish-manifest';
import { publishManifestToCoursePlatform } from '../lib/server/course-publish-client';

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3101);
const CLASSROOMS_DIR = path.join(process.cwd(), 'data', 'classrooms');

type PublishMode = 'preview' | 'commit';

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

function badRequest(message: string, details?: string) {
  return json(
    {
      success: false,
      error: message,
      ...(details ? { details } : {}),
    },
    { status: 400 },
  );
}

function serverError(message: string, details?: string) {
  return json(
    {
      success: false,
      error: message,
      ...(details ? { details } : {}),
    },
    { status: 500 },
  );
}

function isValidClassroomId(id: string) {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

async function readClassroom(id: string) {
  const filePath = path.join(CLASSROOMS_DIR, `${id}.json`);
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function handleManifest(request: Request) {
  const url = new URL(request.url);
  const id = String(url.searchParams.get('id') || '').trim();
  if (!id) {
    return badRequest('Missing required parameter: id');
  }
  if (!isValidClassroomId(id)) {
    return badRequest('Invalid classroom id');
  }

  try {
    const classroom = await readClassroom(id);
    if (!classroom) {
      return json(
        {
          success: false,
          error: 'Classroom not found',
        },
        { status: 404 },
      );
    }

    const manifest = buildCoursePublishManifest(classroom);
    return json({
      success: true,
      classroomId: id,
      manifest,
    });
  } catch (error) {
    return serverError(
      'Failed to build publish manifest',
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function handlePublish(request: Request) {
  let body: {
    id?: string;
    mode?: PublishMode;
    options?: Record<string, unknown>;
  } = {};

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest('Invalid JSON body');
  }

  const id = String(body.id || '').trim();
  const mode: PublishMode = body.mode === 'commit' ? 'commit' : 'preview';

  if (!id) {
    return badRequest('Missing required field: id');
  }
  if (!isValidClassroomId(id)) {
    return badRequest('Invalid classroom id');
  }

  try {
    const classroom = await readClassroom(id);
    if (!classroom) {
      return json(
        {
          success: false,
          error: 'Classroom not found',
        },
        { status: 404 },
      );
    }

    const manifest = buildCoursePublishManifest(classroom);
    const upstream = await publishManifestToCoursePlatform({
      manifest,
      mode,
      options: body.options as never,
    });

    return json({
      success: true,
      classroomId: id,
      mode,
      upstream,
    });
  } catch (error) {
    return json(
      {
        success: false,
        error: 'Failed to publish classroom to course platform',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({
        status: 'ok',
        port: PORT,
      });
    }

    if (request.method === 'GET' && url.pathname === '/api/classroom/publish-manifest') {
      return handleManifest(request);
    }

    if (request.method === 'POST' && url.pathname === '/api/classroom/publish-course') {
      return handlePublish(request);
    }

    return json(
      {
        success: false,
        error: 'Not Found',
      },
      { status: 404 },
    );
  },
});

console.log(`OpenMAIC publish bridge listening on http://${HOST}:${server.port}`);
