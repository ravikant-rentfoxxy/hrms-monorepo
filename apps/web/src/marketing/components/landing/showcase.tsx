'use client';

import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Briefcase, CalendarCheck2, LayoutDashboard, UserRound, Wallet } from 'lucide-react';
import { Container, Section, SectionHeading } from '@/marketing/components/site/section';
import { Reveal } from '@/marketing/components/site/reveal';
import { Tabs, TabsList, TabsTrigger } from '@/marketing/components/ui/tabs';
import {
  AdminDashboard,
  AttendanceDashboard,
  EmployeeDashboard,
  PayrollDashboard,
  RecruitmentDashboard,
} from '@/marketing/components/dashboards/screens';

const SCREENS = [
  {
    id: 'admin',
    label: 'HR Admin',
    icon: LayoutDashboard,
    title: 'The whole company at a glance',
    text: 'Headcount, today’s attendance, pending leave, payroll status and the hiring pipeline — the morning view for HR.',
    Screen: AdminDashboard,
  },
  {
    id: 'employee',
    label: 'Employee',
    icon: UserRound,
    title: 'Self-service that employees actually use',
    text: 'Check in from anywhere their work mode allows, see leave balances, open payslips and track every request.',
    Screen: EmployeeDashboard,
  },
  {
    id: 'recruitment',
    label: 'Recruitment',
    icon: Briefcase,
    title: 'A guided hiring flow',
    text: 'From approved requisition to live job post, candidate pipeline, interviews, offers and pre-joining — step by step.',
    Screen: RecruitmentDashboard,
  },
  {
    id: 'payroll',
    label: 'Payroll',
    icon: Wallet,
    title: 'Payroll with built-in checkpoints',
    text: 'Draft, lock, approve, publish, paid — with PF, ESI, Professional Tax and TDS computed for every employee.',
    Screen: PayrollDashboard,
  },
  {
    id: 'attendance',
    label: 'Attendance',
    icon: CalendarCheck2,
    title: 'Attendance that knows where work happens',
    text: 'Geofenced office check-ins, captured locations for remote and field staff, and late marks against each shift.',
    Screen: AttendanceDashboard,
  },
] as const;

export function Showcase() {
  const [tab, setTab] = React.useState<string>(SCREENS[0].id);
  const reduce = useReducedMotion();
  const current = SCREENS.find((s) => s.id === tab)!;

  return (
    <Section id="product" className="relative overflow-hidden" aria-labelledby="product-title">
      <div className="pointer-events-none absolute inset-x-0 top-1/3 -z-10 h-[30rem] bg-[radial-gradient(ellipse_at_center,rgb(16_184_138/0.08),transparent_65%)]" />
      <Container>
        <SectionHeading
          id="product-title"
          eyebrow="Product tour"
          title="Designed for every person in your company"
          description="Purpose-built views for HR, managers, finance and employees — all on the same live data."
        />
        <Reveal className="mt-10 flex justify-center">
          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
              <TabsList className="mx-auto flex w-max">
                {SCREENS.map((s) => (
                  <TabsTrigger key={s.id} value={s.id}>
                    <s.icon aria-hidden="true" />
                    {s.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </Tabs>
        </Reveal>

        <div className="mt-10 grid grid-cols-1 items-start gap-8 lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-12">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={current.id + '-copy'}
              initial={reduce ? false : { opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? undefined : { opacity: 0, x: -10 }}
              transition={{ duration: 0.3 }}
              className="lg:sticky lg:top-28"
              aria-live="polite"
            >
              <span className="grid size-12 place-items-center rounded-2xl bg-ink-900 text-brand-300">
                <current.icon className="size-6" aria-hidden="true" />
              </span>
              <h3 className="mt-5 text-2xl font-bold tracking-tight text-ink-950">{current.title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-600">{current.text}</p>
              <p className="mt-6 text-xs text-ink-400">Preview shown with sample data.</p>
            </motion.div>
          </AnimatePresence>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={current.id}
              initial={reduce ? false : { opacity: 0, y: 14, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? undefined : { opacity: 0, y: -8, scale: 0.99 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="min-w-0"
            >
              <current.Screen />
            </motion.div>
          </AnimatePresence>
        </div>
      </Container>
    </Section>
  );
}
