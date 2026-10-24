import type { Request } from 'express';
import { h, ok } from '../utils/http';
import { ctx, employeeIdOrThrow } from '../middleware/auth';
import { audit, diff } from '../lib/audit';
import * as surveyService from '../services/survey.service';
import type { SurveyInput } from '../services/survey.service';

const id = (req: Request): string => req.params.id as string;

export const list = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await surveyService.listSurveys(tenantId));
});

export const open = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await surveyService.openSurveys(tenantId, employeeIdOrThrow(req)));
});

export const get = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await surveyService.getSurvey(tenantId, id(req), { role: auth.role, employeeId: auth.employeeId }));
});

export const create = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  const survey = await surveyService.createSurvey(tenantId, auth.employeeId, req.body as SurveyInput);
  await audit(req, { entity: 'Survey', entityId: survey.id, action: 'CREATE', after: { title: survey.title, anonymous: survey.anonymous } });
  ok(res, survey, 201);
});

export const update = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await surveyService.updateSurvey(tenantId, id(req), req.body as Partial<SurveyInput>);
  await audit(req, { entity: 'Survey', entityId: after.id, action: 'UPDATE', ...diff(before, after) });
  ok(res, after);
});

export const remove = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const survey = await surveyService.deleteSurvey(tenantId, id(req));
  await audit(req, { entity: 'Survey', entityId: survey.id, action: 'DELETE', before: { title: survey.title, status: survey.status } });
  ok(res, { deleted: true });
});

const setStatus = (status: 'OPEN' | 'CLOSED') =>
  h(async (req, res) => {
    const { tenantId } = ctx(req);
    const { before, after } = await surveyService.setStatus(tenantId, id(req), status);
    await audit(req, { entity: 'Survey', entityId: after.id, action: 'STATUS', before: { status: before.status }, after: { status } });
    ok(res, after);
  });

export const openSurvey = setStatus('OPEN');
export const closeSurvey = setStatus('CLOSED');

export const respond = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { answers } = req.body as { answers: Record<string, number | string> };
  ok(res, await surveyService.respond(tenantId, id(req), employeeIdOrThrow(req), answers), 201);
});

export const results = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await surveyService.results(tenantId, id(req), req.query as { department?: string }));
});
