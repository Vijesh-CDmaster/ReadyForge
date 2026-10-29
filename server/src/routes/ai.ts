import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { getAuthorizedProject, requireAuth, AuthedRequest } from '../middleware/auth';
import { asyncHandler, validateBody } from '../http';
import { audit, clientIp } from '../audit';
import { classifyProject } from '../ai/classify';
import { generateQuestions } from '../ai/questions';
import { verifyClaims } from '../ai/claims';
import { adaptiveQuestionCount } from '../ai/taste';
import { TasteProfile } from '../models/TasteProfile';
import { KnowledgeInput } from '../models/KnowledgeInput';

export const aiRouter = Router();
aiRouter.use(requireAuth);

const aiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'AI rate limit exceeded, please wait a moment.' },
});

/* classify */
aiRouter.post(
  '/classify-project',
  aiLimiter,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(z.object({ description: z.string().min(5).max(4000) }), req.body);
    const result = await classifyProject(body.description);
    res.json({ ...result.data, aiSource: result.source, model: result.model });
  })
);

/* adaptive questions */
aiRouter.post(
  '/generate-questions',
  aiLimiter,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(z.object({ projectId: z.string().min(1), count: z.number().min(1).max(6).optional() }), req.body);
    const { project } = await getAuthorizedProject(req.user!, body.projectId);

    const inputs = await KnowledgeInput.find({ projectId: project._id });

    // Personalised question flow (#20): Workflow DNA + taste confidence trim or widen the set.
    const taste = await TasteProfile.findOne({ userId: req.user!._id, projectId: { $exists: false } });
    const adaptive = adaptiveQuestionCount(taste, body.count ?? 6);
    const count = body.count ?? Math.min(6, adaptive.count);

    const result = await generateQuestions({
      project,
      inputs: inputs as never,
      count,
    });

    audit({
      workspaceId: project.workspaceId.toString(),
      projectId: project._id.toString(),
      actorId: req.user!._id.toString(),
      actorType: 'ai',
      action: 'ai.generate_questions',
      entityType: 'question_set',
      after: { count: result.questions.length, source: result.source, model: result.model },
      ipAddress: clientIp(req),
    });

    res.json({
      questions: result.questions,
      aiSource: result.source,
      model: result.model,
      tasteConfig: { count, rationale: adaptive.rationale },
    });
  })
);

/* claim verification */
aiRouter.post(
  '/verify-claims',
  aiLimiter,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(
      z.object({ projectId: z.string().min(1), content: z.string().min(10).max(20000) }),
      req.body
    );
    const { project } = await getAuthorizedProject(req.user!, body.projectId);
    const inputs = await KnowledgeInput.find({ projectId: project._id });
    const approvedFacts = inputs.filter(
      (i) => i.status === 'approved' && (i.type === 'fact' || i.type === 'price' || i.type === 'claim')
    );

    const result = await verifyClaims({ content: body.content, approvedFacts: approvedFacts as never });

    audit({
      workspaceId: project.workspaceId.toString(),
      projectId: project._id.toString(),
      actorId: req.user!._id.toString(),
      actorType: 'ai',
      action: 'ai.verify_claims',
      entityType: 'claim_report',
      after: {
        claims: result.checks.length,
        unsupported: result.checks.filter((c) => c.status === 'unsupported').length,
        source: result.source,
      },
      ipAddress: clientIp(req),
    });

    res.json({
      checks: result.checks,
      aiSource: result.source,
      model: result.model,
      disclaimer: 'Claim checks cite only approved facts. Missing evidence is reported as unavailable — never invented.',
    });
  })
);
