/**
 * Engagement surveys: builder (RATING 1–5, NPS 0–10, TEXT, CHOICE),
 * DRAFT → OPEN → CLOSED, one response per employee, aggregated results.
 *
 * Anonymity: every response carries respondentHash = sha256(surveyId +
 * employeeId) to block double submission; employeeId is stored only for
 * non-anonymous surveys. The respondent's department is kept with the
 * answers (SurveyResponse.answers = { department, values }) so results can be
 * sliced by department; any slice with fewer than MIN_GROUP responses is
 * suppressed so individuals can't be singled out.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { ApiError } from '../utils/http';
import { sha256 } from '../utils/crypto';
import { dateOnlyUTC } from '../utils/geo';
import { type Actor, isHrAdmin } from './talent.helpers';

export const MIN_GROUP = 3;

export interface Question {
  id: string;
  text: string;
  type: 'RATING' | 'NPS' | 'TEXT' | 'CHOICE';
  options?: string[];
  required?: boolean;
}

export interface SurveyInput {
  title: string;
  description?: string;
  anonymous?: boolean;
  questions: (Omit<Question, 'id'> & { id?: string })[];
  closesOn?: Date | null;
}

interface StoredAnswers {
  department: string;
  values: Record<string, number | string>;
}

const respondentHash = (surveyId: string, employeeId: string) => sha256(surveyId + employeeId);

/** Stable ids (q1, q2, …) for new questions; existing ids are kept. */
function normalizeQuestions(questions: SurveyInput['questions']): Question[] {
  const used = new Set(questions.map((q) => q.id).filter(Boolean));
  let n = 1;
  const out = questions.map((q) => {
    let qid = q.id;
    if (!qid) {
      while (used.has(`q${n}`)) n++;
      qid = `q${n}`;
      used.add(qid);
    }
    return {
      id: qid,
      text: q.text,
      type: q.type,
      required: q.required ?? true,
      ...(q.type === 'CHOICE' ? { options: [...new Set(q.options ?? [])] } : {}),
    };
  });
  if (new Set(out.map((q) => q.id)).size !== out.length) throw ApiError.badRequest('Question ids must be unique');
  return out;
}

const questionsOf = (survey: { questions: Prisma.JsonValue }): Question[] => (survey.questions as unknown as Question[]) ?? [];

/** An OPEN survey whose closing date has passed is treated as closed. */
const isAcceptingResponses = (s: { status: string; closesOn: Date | null }) =>
  s.status === 'OPEN' && (!s.closesOn || s.closesOn >= dateOnlyUTC());

async function getSurveyOrThrow(companyId: string, id: string) {
  const survey = await prisma.survey.findFirst({ where: { id, companyId } });
  if (!survey) throw ApiError.notFound('Survey not found');
  return survey;
}

// ---- Admin ----

export async function listSurveys(companyId: string) {
  const [surveys, eligible] = await Promise.all([
    prisma.survey.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } }),
    prisma.employee.count({ where: { companyId, isActive: true } }),
  ]);
  const counts = await prisma.surveyResponse.groupBy({
    by: ['surveyId'],
    where: { companyId, surveyId: { in: surveys.map((s) => s.id) } },
    _count: { _all: true },
  });
  const byId = new Map(counts.map((c) => [c.surveyId, c._count._all]));
  return surveys.map((s) => ({
    ...s,
    questionCount: questionsOf(s).length,
    responses: byId.get(s.id) ?? 0,
    responseRate: eligible ? (byId.get(s.id) ?? 0) / eligible : 0,
    acceptingResponses: isAcceptingResponses(s),
  }));
}

export async function getSurvey(companyId: string, id: string, actor: Actor) {
  const survey = await getSurveyOrThrow(companyId, id);
  if (survey.status === 'DRAFT' && !isHrAdmin(actor.role)) throw ApiError.notFound('Survey not found');
  const responded = actor.employeeId
    ? !!(await prisma.surveyResponse.findUnique({
        where: { surveyId_respondentHash: { surveyId: id, respondentHash: respondentHash(id, actor.employeeId) } },
        select: { id: true },
      }))
    : null; // no employee profile → cannot respond
  return { ...survey, responded, acceptingResponses: isAcceptingResponses(survey) };
}

export async function createSurvey(companyId: string, createdById: string | null, input: SurveyInput) {
  return prisma.survey.create({
    data: {
      companyId,
      createdById,
      title: input.title,
      description: input.description ?? '',
      anonymous: input.anonymous ?? true,
      closesOn: input.closesOn ? dateOnlyUTC(input.closesOn) : null,
      questions: normalizeQuestions(input.questions) as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function updateSurvey(companyId: string, id: string, input: Partial<SurveyInput>) {
  const before = await getSurveyOrThrow(companyId, id);
  if (before.status === 'CLOSED') throw ApiError.badRequest('A closed survey cannot be edited');
  if (before.status === 'OPEN' && (input.questions || input.anonymous !== undefined)) {
    throw ApiError.badRequest('Questions and anonymity are locked once the survey is open — only the title, description and closing date can change');
  }
  const after = await prisma.survey.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.anonymous !== undefined ? { anonymous: input.anonymous } : {}),
      ...(input.closesOn !== undefined ? { closesOn: input.closesOn ? dateOnlyUTC(input.closesOn) : null } : {}),
      ...(input.questions ? { questions: normalizeQuestions(input.questions) as unknown as Prisma.InputJsonValue } : {}),
    },
  });
  return { before, after };
}

export async function deleteSurvey(companyId: string, id: string) {
  const survey = await getSurveyOrThrow(companyId, id);
  await prisma.survey.delete({ where: { id } });
  return survey;
}

export async function setStatus(companyId: string, id: string, status: 'OPEN' | 'CLOSED') {
  const before = await getSurveyOrThrow(companyId, id);
  if (status === 'OPEN') {
    if (before.status !== 'DRAFT') throw ApiError.badRequest('Only a draft survey can be opened');
    if (questionsOf(before).length === 0) throw ApiError.badRequest('Add at least one question first');
    if (before.closesOn && before.closesOn < dateOnlyUTC()) throw ApiError.badRequest('The closing date is in the past');
  } else if (before.status !== 'OPEN') {
    throw ApiError.badRequest('Only an open survey can be closed');
  }
  const after = await prisma.survey.update({ where: { id }, data: { status } });
  if (status === 'OPEN') {
    const employees = await prisma.employee.findMany({ where: { companyId, isActive: true }, select: { id: true } });
    await notify(companyId, employees.map((e) => e.id), {
      event: 'survey.opened',
      title: 'New survey',
      body: `"${after.title}"${after.anonymous ? ' (anonymous)' : ''} — please share your feedback${after.closesOn ? ` by ${after.closesOn.toISOString().slice(0, 10)}` : ''}.`,
      link: `/surveys/${id}`,
    });
  }
  return { before, after };
}

// ---- Employee ----

export async function openSurveys(companyId: string, employeeId: string) {
  const surveys = await prisma.survey.findMany({ where: { companyId, status: 'OPEN' }, orderBy: { createdAt: 'desc' } });
  const live = surveys.filter(isAcceptingResponses);
  const hashes = live.map((s) => respondentHash(s.id, employeeId));
  const done = await prisma.surveyResponse.findMany({
    where: { companyId, respondentHash: { in: hashes } },
    select: { surveyId: true },
  });
  const responded = new Set(done.map((d) => d.surveyId));
  return live.map((s) => ({ ...s, responded: responded.has(s.id) }));
}

/** Validates answers against the questions; returns the cleaned values. */
function validateAnswers(questions: Question[], answers: Record<string, number | string>) {
  const values: Record<string, number | string> = {};
  for (const q of questions) {
    const raw = answers[q.id];
    const empty = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
    if (empty) {
      if (q.required !== false) throw ApiError.badRequest(`Please answer: "${q.text}"`);
      continue;
    }
    if (q.type === 'RATING' || q.type === 'NPS') {
      const n = typeof raw === 'number' ? raw : Number(raw);
      const [min, max] = q.type === 'RATING' ? [1, 5] : [0, 10];
      if (!Number.isInteger(n) || n < min || n > max) throw ApiError.badRequest(`"${q.text}" needs a whole number from ${min} to ${max}`);
      values[q.id] = n;
    } else if (q.type === 'CHOICE') {
      const s = String(raw);
      if (!(q.options ?? []).includes(s)) throw ApiError.badRequest(`"${s}" is not an option for "${q.text}"`);
      values[q.id] = s;
    } else {
      values[q.id] = String(raw).trim().slice(0, 5000);
    }
  }
  return values;
}

export async function respond(companyId: string, surveyId: string, employeeId: string, answers: Record<string, number | string>) {
  const survey = await getSurveyOrThrow(companyId, surveyId);
  if (!isAcceptingResponses(survey)) throw ApiError.badRequest('This survey is not accepting responses');
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: { department: true } });
  if (!employee) throw ApiError.forbidden();
  const values = validateAnswers(questionsOf(survey), answers);
  const stored: StoredAnswers = { department: employee.department, values };
  try {
    await prisma.surveyResponse.create({
      data: {
        companyId,
        surveyId,
        employeeId: survey.anonymous ? null : employeeId,
        respondentHash: respondentHash(surveyId, employeeId),
        answers: stored as unknown as Prisma.InputJsonValue,
        // Anonymous: keep only the day, so submission time can't be matched to a person.
        ...(survey.anonymous ? { submittedAt: dateOnlyUTC() } : {}),
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') throw ApiError.conflict('You have already responded to this survey');
    throw err;
  }
  return { submitted: true };
}

// ---- Results ----

export async function results(companyId: string, id: string, filter: { department?: string }) {
  const survey = await getSurveyOrThrow(companyId, id);
  const questions = questionsOf(survey);
  const responses = await prisma.surveyResponse.findMany({
    where: { companyId, surveyId: id },
    select: { answers: true, employeeId: true, submittedAt: true },
  });
  const parsed = responses.map((r) => {
    const a = r.answers as unknown as Partial<StoredAnswers> | null;
    return { department: a?.department ?? '', values: a?.values ?? {}, employeeId: r.employeeId, submittedAt: r.submittedAt };
  });

  // Department breakdown (counts only; small groups shown as "<3").
  const deptCounts = new Map<string, number>();
  for (const p of parsed) deptCounts.set(p.department || 'Unassigned', (deptCounts.get(p.department || 'Unassigned') ?? 0) + 1);
  const departments = [...deptCounts.entries()]
    .map(([name, count]) => ({ name, responses: count >= MIN_GROUP ? count : null, suppressed: count < MIN_GROUP }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const scoped = filter.department
    ? parsed.filter((p) => (p.department || 'Unassigned') === filter.department)
    : parsed;
  const eligible = await prisma.employee.count({
    where: { companyId, isActive: true, ...(filter.department ? { department: filter.department === 'Unassigned' ? '' : filter.department } : {}) },
  });

  const base = {
    survey: { id: survey.id, title: survey.title, status: survey.status, anonymous: survey.anonymous, closesOn: survey.closesOn },
    department: filter.department ?? null,
    responses: scoped.length,
    eligible,
    responseRate: eligible ? Math.min(1, scoped.length / eligible) : 0,
    departments,
    minGroupSize: MIN_GROUP,
  };
  // Small groups are suppressed when slicing by department, and always for anonymous surveys.
  if ((filter.department || survey.anonymous) && scoped.length < MIN_GROUP) {
    return { ...base, suppressed: true, questions: [] };
  }

  const names = new Map<string, string>();
  if (!survey.anonymous) {
    const ids = [...new Set(scoped.map((p) => p.employeeId).filter((x): x is string => !!x))];
    const rows = await prisma.employee.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, name: true } });
    for (const r of rows) names.set(r.id, r.name);
  }

  const perQuestion = questions.map((q) => {
    const answered = scoped.filter((p) => p.values[q.id] !== undefined);
    const head = { id: q.id, text: q.text, type: q.type, answered: answered.length };
    if (q.type === 'RATING' || q.type === 'NPS') {
      const nums = answered.map((p) => Number(p.values[q.id]));
      const [min, max] = q.type === 'RATING' ? [1, 5] : [0, 10];
      const distribution = Array.from({ length: max - min + 1 }, (_, i) => ({
        value: min + i,
        count: nums.filter((n) => n === min + i).length,
      }));
      const average = nums.length ? Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 100) / 100 : null;
      if (q.type === 'RATING') return { ...head, average, distribution };
      const promoters = nums.filter((n) => n >= 9).length;
      const detractors = nums.filter((n) => n <= 6).length;
      const passives = nums.length - promoters - detractors;
      return {
        ...head,
        average,
        distribution,
        promoters,
        passives,
        detractors,
        nps: nums.length ? Math.round(((promoters - detractors) / nums.length) * 100) : null,
      };
    }
    if (q.type === 'CHOICE') {
      return {
        ...head,
        distribution: (q.options ?? []).map((o) => ({ value: o, count: answered.filter((p) => p.values[q.id] === o).length })),
      };
    }
    // TEXT: answers only (shuffled order for anonymous surveys so they can't be matched to submission order).
    const texts = answered.map((p) => ({
      text: String(p.values[q.id]),
      ...(survey.anonymous ? {} : { respondent: p.employeeId ? (names.get(p.employeeId) ?? null) : null }),
    }));
    if (survey.anonymous) texts.sort((a, b) => a.text.localeCompare(b.text));
    return { ...head, answers: texts };
  });

  return { ...base, suppressed: false, questions: perQuestion };
}

// ---- Jobs ----

/** Closes OPEN surveys whose closing date has passed. */
export async function closeExpired(companyId: string): Promise<number> {
  const result = await prisma.survey.updateMany({
    where: { companyId, status: 'OPEN', closesOn: { lt: dateOnlyUTC() } },
    data: { status: 'CLOSED' },
  });
  return result.count;
}
