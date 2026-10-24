/** Announcements with per-employee read tracking. */
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { ApiError } from '../utils/http';
import { dispatchIntegrationEvent } from './integration.service';

export interface AnnouncementInput {
  title: string;
  body: string;
  category?: string;
}

export async function listAnnouncements(companyId: string, readerEmployeeId: string | null) {
  const announcements = await prisma.announcement.findMany({
    where: { companyId },
    include: {
      author: { select: { id: true, name: true } },
      reads: readerEmployeeId ? { where: { employeeId: readerEmployeeId }, select: { readAt: true } } : false,
    },
    orderBy: { postedOn: 'desc' },
    take: 100,
  });
  return announcements.map(({ reads, ...a }) => ({ ...a, read: Array.isArray(reads) && reads.length > 0 }));
}

export async function createAnnouncement(companyId: string, authorEmployeeId: string | null, input: AnnouncementInput) {
  const announcement = await prisma.announcement.create({ data: { ...input, companyId, authorId: authorEmployeeId } });
  const everyone = await prisma.employee.findMany({ where: { companyId, isActive: true }, select: { id: true } });
  await notify(
    companyId,
    everyone.map((e) => e.id).filter((id) => id !== authorEmployeeId),
    { event: 'announcement.posted', title: announcement.title, body: announcement.body.slice(0, 200), link: '/announcements' }
  );
  await dispatchIntegrationEvent(companyId, 'announcement.posted', { title: announcement.title, body: announcement.body, category: announcement.category });
  return announcement;
}

export async function markRead(companyId: string, announcementId: string, employeeId: string): Promise<void> {
  const announcement = await prisma.announcement.findFirst({ where: { id: announcementId, companyId } });
  if (!announcement) throw ApiError.notFound('Announcement not found');
  await prisma.announcementRead.upsert({
    where: { announcementId_employeeId: { announcementId, employeeId } },
    create: { announcementId, employeeId },
    update: {},
  });
}

export async function deleteAnnouncement(companyId: string, id: string): Promise<void> {
  const result = await prisma.announcement.deleteMany({ where: { id, companyId } });
  if (result.count === 0) throw ApiError.notFound('Announcement not found');
}
