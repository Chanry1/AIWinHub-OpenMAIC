import type { PBLProjectConfig } from '@/lib/pbl/types';
import type { PersistedClassroomData } from '@/lib/server/classroom-storage';
import type { QuizQuestion, Scene, Stage } from '@/lib/types/stage';

export type CoursePublishBlockType = 'heading' | 'paragraph' | 'quote' | 'tip' | 'image';

export interface CoursePublishArticleBlock {
  type: CoursePublishBlockType;
  text?: string;
  level?: 2 | 3;
  url?: string;
  caption?: string;
}

export interface CoursePublishMediaCandidate {
  kind: 'audio' | 'video' | 'image';
  sourceUrl?: string;
  mimeType?: string;
  durationSeconds?: number;
}

export interface CoursePublishChapterManifest {
  sourceSceneId: string;
  sourceSceneType: 'slide' | 'quiz' | 'interactive' | 'pbl';
  title: string;
  slug: string;
  description?: string;
  orderIndex: number;
  publishMode: 'article' | 'audio' | 'video' | 'defer';
  articleBlocks?: CoursePublishArticleBlock[];
  mediaCandidates?: CoursePublishMediaCandidate[];
  estimatedDurationSeconds?: number;
  isPreview?: boolean;
  unsupportedReason?: string;
}

export interface OpenMAICCoursePublishManifestV1 {
  schemaVersion: 'openmaic-course-publish-v1';
  sourceSystem: 'openmaic';
  sourceEntityId: string;
  sourceJobId?: string;
  sourceVersion: string;
  generatedAt: string;
  language: 'zh-CN' | 'en-US';
  title: string;
  subtitle?: string;
  summary: string;
  audience?: string;
  requirement?: string;
  presenterName?: string;
  presenterBio?: string;
  coverCandidateUrl?: string;
  deliveryFormats: Array<'article' | 'audio' | 'video' | 'interactive'>;
  chapters: CoursePublishChapterManifest[];
  warnings: string[];
}

function normalizeText(value?: string | null) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function slugify(value: string) {
  const ascii = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return ascii || 'untitled';
}

function dedupeStrings(values: Array<string | null | undefined>) {
  const items: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(normalized);
  }
  return items;
}

function pushBlock(blocks: CoursePublishArticleBlock[], block: CoursePublishArticleBlock | null) {
  if (!block) return;
  if (block.type === 'image') {
    if (!String(block.url || '').trim()) return;
    blocks.push({
      type: 'image',
      url: String(block.url || '').trim(),
      caption: normalizeText(block.caption),
    });
    return;
  }

  const text = normalizeText(block.text);
  if (!text) return;
  blocks.push({
    type: block.type,
    text,
    ...(block.level ? { level: block.level } : {}),
  });
}

function estimateDurationSecondsFromBlocks(blocks: CoursePublishArticleBlock[]) {
  const totalChars = blocks
    .map((block) => (block.type === 'image' ? normalizeText(block.caption) : normalizeText(block.text)))
    .join('')
    .length;
  if (!totalChars) return undefined;
  return Math.max(45, Math.ceil(totalChars / 6));
}

function collectSlideTexts(scene: Scene) {
  const canvas = (scene.content as any)?.canvas;
  const elements = Array.isArray(canvas?.elements) ? canvas.elements : [];
  const texts: string[] = [];

  for (const element of elements) {
    if (element?.type === 'text' || typeof element?.content === 'string') {
      const text = normalizeText(element?.content);
      if (text) texts.push(text);
      continue;
    }
    if (element?.type === 'shape' && element?.text?.content) {
      const text = normalizeText(element.text.content);
      if (text) texts.push(text);
    }
  }

  return dedupeStrings(texts);
}

function collectSlideImages(scene: Scene) {
  const canvas = (scene.content as any)?.canvas;
  const backgroundSrc = String(canvas?.background?.image?.src || '').trim();
  const elements = Array.isArray(canvas?.elements) ? canvas.elements : [];
  const images: string[] = [];

  if (backgroundSrc) images.push(backgroundSrc);
  for (const element of elements) {
    if (element?.type === 'image' && typeof element?.src === 'string' && element.src.trim()) {
      images.push(element.src.trim());
    }
  }
  return dedupeStrings(images);
}

function buildSlideChapter(scene: Scene): CoursePublishChapterManifest {
  const articleBlocks: CoursePublishArticleBlock[] = [];
  const texts = collectSlideTexts(scene);
  const images = collectSlideImages(scene);

  pushBlock(articleBlocks, {
    type: 'heading',
    text: scene.title,
    level: 2,
  });

  for (const text of texts) {
    pushBlock(articleBlocks, {
      type: articleBlocks.length <= 1 ? 'paragraph' : 'paragraph',
      text,
    });
  }

  for (const image of images.slice(0, 4)) {
    pushBlock(articleBlocks, {
      type: 'image',
      url: image,
      caption: scene.title,
    });
  }

  return {
    sourceSceneId: scene.id,
    sourceSceneType: 'slide',
    title: scene.title,
    slug: slugify(scene.title),
    description: texts[0] || scene.title,
    orderIndex: scene.order,
    publishMode: 'article',
    articleBlocks,
    mediaCandidates: images.map((image) => ({
      kind: 'image' as const,
      sourceUrl: image,
    })),
    estimatedDurationSeconds: estimateDurationSecondsFromBlocks(articleBlocks),
  };
}

function buildQuizQuestionBlocks(questions: QuizQuestion[]) {
  const blocks: CoursePublishArticleBlock[] = [];

  questions.forEach((question, index) => {
    pushBlock(blocks, {
      type: 'quote',
      text: `问题 ${index + 1}：${question.question}`,
    });
    if (Array.isArray(question.options) && question.options.length > 0) {
      pushBlock(blocks, {
        type: 'paragraph',
        text: question.options.map((option) => `${option.value}. ${option.label}`).join('\n'),
      });
    }
    if (Array.isArray(question.answer) && question.answer.length > 0) {
      pushBlock(blocks, {
        type: 'tip',
        text: `参考答案：${question.answer.join(' / ')}`,
      });
    }
    if (question.analysis) {
      pushBlock(blocks, {
        type: 'paragraph',
        text: `解析：${question.analysis}`,
      });
    }
  });

  return blocks;
}

function buildQuizChapter(scene: Scene): CoursePublishChapterManifest {
  const questions = Array.isArray((scene.content as any)?.questions)
    ? ((scene.content as any).questions as QuizQuestion[])
    : [];
  const articleBlocks: CoursePublishArticleBlock[] = [];

  pushBlock(articleBlocks, {
    type: 'heading',
    text: scene.title,
    level: 2,
  });
  pushBlock(articleBlocks, {
    type: 'paragraph',
    text: '本章节来自 OpenMAIC 测验场景，当前先以图文方式发布到 course 平台。',
  });

  for (const block of buildQuizQuestionBlocks(questions)) {
    pushBlock(articleBlocks, block);
  }

  return {
    sourceSceneId: scene.id,
    sourceSceneType: 'quiz',
    title: scene.title,
    slug: slugify(scene.title),
    description: questions[0]?.question || scene.title,
    orderIndex: scene.order,
    publishMode: 'article',
    articleBlocks,
    estimatedDurationSeconds: estimateDurationSecondsFromBlocks(articleBlocks),
  };
}

function buildPblChapter(scene: Scene): CoursePublishChapterManifest {
  const projectConfig = ((scene.content as any)?.projectConfig || {}) as PBLProjectConfig;
  const issueTitles = Array.isArray(projectConfig?.issueboard?.issues)
    ? projectConfig.issueboard.issues.map((issue) => issue.title).filter(Boolean)
    : [];
  const skillLines = Array.isArray(projectConfig?.agents)
    ? projectConfig.agents
        .filter((agent) => agent?.is_user_role)
        .map((agent) => `${agent.name}：${agent.actor_role}`)
    : [];
  const articleBlocks: CoursePublishArticleBlock[] = [];

  pushBlock(articleBlocks, {
    type: 'heading',
    text: projectConfig?.projectInfo?.title || scene.title,
    level: 2,
  });
  pushBlock(articleBlocks, {
    type: 'paragraph',
    text:
      projectConfig?.projectInfo?.description ||
      '本章节来自 OpenMAIC PBL 场景，当前先以结构化图文方式发布到 course 平台。',
  });
  if (skillLines.length > 0) {
    pushBlock(articleBlocks, {
      type: 'tip',
      text: `建议角色：${skillLines.join('；')}`,
    });
  }
  if (issueTitles.length > 0) {
    pushBlock(articleBlocks, {
      type: 'quote',
      text: `任务列表：${issueTitles.join('；')}`,
    });
  }

  return {
    sourceSceneId: scene.id,
    sourceSceneType: 'pbl',
    title: scene.title,
    slug: slugify(scene.title),
    description: projectConfig?.projectInfo?.description || scene.title,
    orderIndex: scene.order,
    publishMode: 'article',
    articleBlocks,
    estimatedDurationSeconds: estimateDurationSecondsFromBlocks(articleBlocks),
  };
}

function buildInteractiveChapter(scene: Scene): CoursePublishChapterManifest {
  return {
    sourceSceneId: scene.id,
    sourceSceneType: 'interactive',
    title: scene.title,
    slug: slugify(scene.title),
    description: '当前 interactive 场景暂不自动发布到 course，需人工评估后处理。',
    orderIndex: scene.order,
    publishMode: 'defer',
    unsupportedReason: 'interactive scenes are not yet natively supported by course chapters',
  };
}

function buildChapterManifest(scene: Scene) {
  if (scene.type === 'slide') return buildSlideChapter(scene);
  if (scene.type === 'quiz') return buildQuizChapter(scene);
  if (scene.type === 'pbl') return buildPblChapter(scene);
  return buildInteractiveChapter(scene);
}

function buildSummary(stage: Stage, chapters: CoursePublishChapterManifest[]) {
  if (normalizeText(stage.description)) return normalizeText(stage.description);
  const sourceTitles = chapters.slice(0, 4).map((chapter) => chapter.title).filter(Boolean);
  if (sourceTitles.length === 0) {
    return `${stage.name} 的课程发布清单由 OpenMAIC 自动生成。`;
  }
  return `${stage.name} 的课程发布清单由 OpenMAIC 自动生成，包含 ${chapters.length} 个章节：${sourceTitles.join('、')}${chapters.length > 4 ? ' 等' : ''}。`;
}

function buildWarnings(chapters: CoursePublishChapterManifest[]) {
  const warnings: string[] = [];
  const deferred = chapters.filter((chapter) => chapter.publishMode === 'defer');
  if (deferred.length > 0) {
    warnings.push(
      `当前有 ${deferred.length} 个章节未自动发布，将以 defer 标记等待人工处理：${deferred
        .slice(0, 4)
        .map((chapter) => chapter.title)
        .join('、')}${deferred.length > 4 ? ' 等' : ''}`,
    );
  }
  return warnings;
}

export function buildCoursePublishManifest(
  classroom: PersistedClassroomData,
): OpenMAICCoursePublishManifestV1 {
  const stage = classroom.stage;
  const orderedScenes = [...(classroom.scenes || [])].sort((left, right) => left.order - right.order);
  const chapters = orderedScenes.map((scene) => buildChapterManifest(scene));
  const firstImage = chapters
    .flatMap((chapter) => chapter.mediaCandidates || [])
    .find((candidate) => candidate.kind === 'image' && candidate.sourceUrl)?.sourceUrl;
  const deliveryFormats = Array.from(
    new Set(
      chapters
        .map((chapter) => chapter.publishMode)
        .map((mode) => (mode === 'defer' ? 'interactive' : mode))
        .filter(Boolean),
    ),
  ) as Array<'article' | 'audio' | 'video' | 'interactive'>;
  const sourceVersion =
    String(stage.updatedAt || '').trim() ||
    String(new Date(classroom.createdAt).getTime() || Date.now());

  return {
    schemaVersion: 'openmaic-course-publish-v1',
    sourceSystem: 'openmaic',
    sourceEntityId: classroom.id,
    sourceVersion,
    generatedAt: classroom.createdAt,
    language: stage.language === 'en-US' ? 'en-US' : 'zh-CN',
    title: normalizeText(stage.name) || `OpenMAIC-${classroom.id}`,
    summary: buildSummary(stage, chapters),
    deliveryFormats,
    ...(normalizeText(stage.description) ? { subtitle: normalizeText(stage.description).slice(0, 120) } : {}),
    ...(firstImage ? { coverCandidateUrl: firstImage } : {}),
    chapters,
    warnings: buildWarnings(chapters),
  };
}
