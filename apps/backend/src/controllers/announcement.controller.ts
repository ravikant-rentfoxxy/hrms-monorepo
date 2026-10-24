import { h, ok } from '../utils/http';
import { ctx, employeeIdOrThrow } from '../middleware/auth';
import * as announcementService from '../services/announcement.service';
import type { AnnouncementInput } from '../services/announcement.service';

export const list = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await announcementService.listAnnouncements(tenantId, auth.employeeId));
});

export const create = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(res, await announcementService.createAnnouncement(tenantId, auth.employeeId, req.body as AnnouncementInput), 201);
});

export const markRead = h(async (req, res) => {
  const { tenantId } = ctx(req);
  await announcementService.markRead(tenantId, req.params.id as string, employeeIdOrThrow(req));
  ok(res, { read: true });
});

export const remove = h(async (req, res) => {
  const { tenantId } = ctx(req);
  await announcementService.deleteAnnouncement(tenantId, req.params.id as string);
  ok(res, { deleted: true });
});
