import { DemoDialogProvider } from '@/marketing/components/demo/demo-dialog';

/** Public pages (landing, /login, /demo): marketing theme + the site-wide demo dialog. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="marketing min-h-dvh bg-canvas text-ink-900">
      <DemoDialogProvider>{children}</DemoDialogProvider>
    </div>
  );
}
